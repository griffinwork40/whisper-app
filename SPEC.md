# Whisper App — Feature Specification

**Type:** New Feature / Greenfield Application  
**Date:** 2025-05-11  
**Target Platform:** macOS (Apple Silicon — M-series only)  
**Runtime:** Node.js v24 + TypeScript, Python 3.14 (mlx-whisper backend)

---

## 1. Problem Statement

Dictation on macOS is either cloud-dependent (Apple Dictation, Whisper via OpenAI API) or requires a Python-centric toolchain that is awkward to package and distribute. A lightweight, local, always-available speech-to-text tool is needed that:

- Runs **entirely on-device** using `mlx-whisper` on Apple Silicon's Neural Engine / GPU.
- Exposes a **minimal menu-bar UI** (no Dock icon, no full app window) so it stays out of the way.
- Allows the user to **press a global hotkey** → speak → release → text is transcribed and placed on the clipboard (and optionally auto-typed into the focused app).
- Is written in **Node.js + TypeScript** so it is easy to extend, distribute via `npm pack`, and maintain by JS-native developers.

The adjacent `whisper-dictation` project proves the concept but is Python-only (`rumps` + `pyaudio` + `pynput`) and uses the non-MLX `openai-whisper` model. This project replaces that stack with a TypeScript-first orchestration layer that shells out to the already-installed `mlx_whisper` Python package.

---

## 2. Scope

### In Scope

| Area | Detail |
|---|---|
| **Menu-bar tray app** | Electron (or `@electron/remote`-free, lightweight) menu-bar application — no Dock icon (`LSUIElement = true`) |
| **Global hotkey** | Configurable key combination (default: `⌥⌘` (hold to talk)) to start/stop recording |
| **Audio capture** | Capture microphone audio via Node.js using `node-record-lpcm16` or `ffmpeg` child-process (16 kHz, mono, PCM16) |
| **Transcription backend** | Shell out to `python3 -m mlx_whisper` with the audio file as input; parse stdout for the transcript |
| **Output modes** | (1) Copy to clipboard, (2) Auto-type into focused app via AppleScript `System Events` keystroke |
| **Model selection** | Dropdown in tray menu to choose from locally-cached HuggingFace models (`whisper-tiny`, `whisper-turbo`, `whisper-large-v3-turbo`, `whisper-large-v3-mlx`) |
| **Status indicator** | Tray icon changes state: idle → recording (red pulse) → processing → done |
| **Settings persistence** | JSON config file in `~/Library/Application Support/whisper-app/config.json` |
| **TypeScript build** | `tsconfig.json` targeting Node 20+; `esbuild` or `tsc` for compilation |
| **macOS permissions** | Guide user through Microphone + Accessibility permission prompts on first launch |

### Out of Scope

- Windows or Linux support.
- Streaming / real-time partial transcription (batch-only: record → transcribe).
- A web UI, API server, or remote access mode.
- Downloading or managing model weights (user must pre-download via `huggingface_hub`; models already cached at `~/.cache/huggingface/hub/`).
- Speaker diarization or multi-speaker transcription.
- Translation mode (mlx-whisper supports it, but the UI will not expose it in v1).
- Packaging into a signed `.app` bundle or notarization (out of scope for this spec; addressed in a future release spec).

---

## 3. Architecture

```
┌──────────────────────────────────────────────┐
│  Electron Main Process (TypeScript)          │
│  ├── Tray icon + context menu (Menu)         │
│  ├── GlobalShortcut (⌥Space)                 │
│  ├── AudioRecorder  ──► ffmpeg child-process │
│  │       writes → /tmp/whisper-XXXX.wav      │
│  └── TranscribeRunner                        │
│          python3 -m mlx_whisper <wav>        │
│          parse stdout → plain text           │
│          → clipboard / AppleScript type      │
└──────────────────────────────────────────────┘
```

**Key design decisions:**

1. **Electron** is chosen over a pure CLI daemon because macOS `globalShortcut` requires a running application event loop, and Electron is the most maintainable TS-native option. It adds ~150 MB but ships a self-contained runtime.
2. **ffmpeg** (already installed at `/opt/homebrew/bin/ffmpeg`) handles recording to avoid native Node audio binding complexity. It writes a `.wav` to `/tmp`, which is deleted after transcription.
3. **`python3 -m mlx_whisper`** is invoked as a child process. stdout is parsed for the transcript text; stderr is discarded unless the exit code is non-zero (error path).
4. Auto-type uses `osascript` (`System Events` / `keystroke`) as a dependency-free approach. Clipboard copy is always the fallback.

---

## 4. Module Breakdown

| Module | Path | Responsibility |
|---|---|---|
| `main.ts` | `src/main.ts` | Electron entry point; wires together all modules |
| `tray.ts` | `src/tray.ts` | Menu-bar icon, context menu, icon state machine |
| `hotkey.ts` | `src/hotkey.ts` | Register / unregister global shortcut |
| `recorder.ts` | `src/recorder.ts` | Spawn ffmpeg, write WAV, emit `recorded` event with file path |
| `transcriber.ts` | `src/transcriber.ts` | Spawn `python3 -m mlx_whisper`, parse output, return transcript string |
| `output.ts` | `src/output.ts` | Clipboard write + AppleScript auto-type |
| `config.ts` | `src/config.ts` | Read/write `~/Library/Application Support/whisper-app/config.json` |
| `logger.ts` | `src/logger.ts` | Lightweight structured logger (stdout + optional file) |

---

## 5. Configuration Schema

```jsonc
// ~/Library/Application Support/whisper-app/config.json
{
  "hotkey": "Option+Cmd",            // Electron accelerator string
  "model": "mlx-community/whisper-turbo",  // HF repo id
  "language": "en",                  // ISO 639-1 or "auto"
  "outputMode": "clipboard",         // "clipboard" | "autotype" | "both"
  "pythonPath": "python3",           // override if needed
  "tempDir": "/tmp"                  // where WAV files are written
}
```

### Hotkey Modes

The app supports two hotkey modes determined by `parseAccelerator` in `src/hotkey.ts`:

- **Modifier-only** (e.g. `Option+Cmd`): hold-to-talk via `uiohook-napi` raw key events. No non-modifier key required.
- **Regular accelerator** (e.g. `Control+Alt+Shift+D`): toggle recording via Electron `globalShortcut`.

---

## 6. Success Criteria

| Criterion | Measurable Target |
|---|---|
| **Latency** | Transcription of a 10-second audio clip completes in ≤ 5 seconds on M4 Pro with `whisper-turbo` model |
| **Accuracy** | Output matches or exceeds Apple Dictation quality on plain English sentences (subjective A/B test) |
| **Memory footprint** | Electron main process stays ≤ 200 MB RSS at idle between transcriptions |
| **Reliability** | Hotkey registers successfully after macOS Accessibility permission is granted; no missed keystrokes under normal use |
| **Correctness** | Transcript text appears on clipboard within 500 ms of mlx_whisper process exit |
| **No crash on error** | If `python3` is not found or mlx_whisper fails, a tray notification is shown and the app continues running |
| **Config round-trip** | Changes made via the tray menu are persisted to `config.json` and survive app restart |

---

## 7. Key Constraints

- **Apple Silicon only.** `mlx-whisper` uses the MLX framework which targets the Apple Neural Engine. The app should detect non-ARM hardware at startup and display a clear error.
- **Python 3 must be installed.** The app relies on the system Python (`python3`) having `mlx_whisper` importable. On first launch, the app verifies this with `python3 -c "import mlx_whisper"` and surfaces a setup guide if it fails.
- **Accessibility permission required.** Auto-type mode requires the app to be granted Accessibility access in System Settings → Privacy & Security. The app should request this gracefully and fall back to clipboard-only if denied.
- **No network calls at runtime.** All transcription is local. No telemetry, no API keys, no internet requirement after model download.
- **Single instance.** Only one instance of the app may run at a time; use Electron's `app.requestSingleInstanceLock()`.
- **Temp file cleanup.** WAV files written to `/tmp` must be deleted immediately after transcription succeeds or fails.

---

## 8. Assumptions

1. The developer has `node@24`, `npm`, and `typescript` available globally.
2. `mlx-whisper@0.4.3` is installed in the system Python at `/opt/homebrew/lib/python3.14/site-packages/`.
3. `ffmpeg@8.1` is available at `/opt/homebrew/bin/ffmpeg`.
4. At least one model is already downloaded to `~/.cache/huggingface/hub/` (confirmed: `whisper-tiny`, `whisper-turbo`, `whisper-large-v3-turbo`, `whisper-large-v3-mlx`).
5. The app targets **macOS Sequoia (26.x)** and above (confirmed: macOS 26.4.1 on the dev machine).
6. Distribution packaging (code signing, notarization, DMG) is deferred to a separate release spec.

---

## 9. Dependencies (Proposed)

| Package | Purpose |
|---|---|
| `electron` | App framework, tray, globalShortcut, clipboard |
| `typescript` | Type-safe source |
| `esbuild` | Fast TS → JS compilation for the main process |
| `electron-builder` | Optional: for future `.app` packaging |
| `@types/node` | Node type definitions |

No native Node addons required. All audio I/O goes through `ffmpeg` subprocesses. All ML inference goes through `python3 -m mlx_whisper` subprocesses.

---

## 10. Out-of-Spec Risks (Flag for Planning Phase)

- **ffmpeg WAV capture on macOS** requires the `avfoundation` input device. The exact device index for the default microphone may vary between machines — the recorder module must enumerate `avfoundation` devices dynamically.
- **Electron + macOS 26 (Tahoe beta)** compatibility is unverified and may require the latest Electron prerelease.
- **mlx_whisper stdout format** is not structured JSON by default; the output format flag `--output-format txt` should be used and the text file read from disk rather than parsing stdout to avoid fragile string parsing.

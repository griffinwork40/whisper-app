# Whisper App

A minimal, **local-only** macOS menu-bar dictation app powered by [`mlx-whisper`](https://github.com/ml-explore/mlx-examples/tree/main/whisper) on Apple Silicon. Press a global hotkey, speak, release — and your speech is transcribed and dropped onto your clipboard (or auto-typed into the focused app).

No cloud. No telemetry. No Dock icon. Just a tray icon and a hotkey.

> **Status:** v0 — works on the developer's machine. Apple Silicon (M-series) only. Not yet code-signed.

---

## Features

- 🎙️ **Hold-to-talk hotkey.** Default `⌥⌘` (hold both, speak, release).
- 🧠 **On-device transcription.** Uses `mlx-whisper` against models cached under `~/.cache/huggingface/hub/`.
- 📋 **Output modes.** Clipboard, auto-type via AppleScript `System Events`, or both.
- 🎛️ **Tray menu.** Pick a model (`whisper-turbo`, `whisper-large-v3-turbo`, …) and an output mode. Settings persist to `~/Library/Application Support/whisper-app/config.json`.
- 🟢 **Status icon.** Idle → recording → processing → done, with a clear error state.
- 🚫 **No Dock icon, no window.** Pure menu-bar app (`LSUIElement = true` equivalent).

---

## Requirements

| | |
|---|---|
| Hardware | Apple Silicon (M-series) — `mlx-whisper` runs on the Neural Engine / GPU |
| macOS | Sequoia (26.x) or later |
| Python | `python3` on PATH with `mlx_whisper` importable |
| ffmpeg | `/opt/homebrew/bin/ffmpeg` (Homebrew install) |
| Models | At least one model pre-downloaded to `~/.cache/huggingface/hub/` |
| Permissions | Microphone (always). Accessibility (only if you want auto-type). |

### One-time setup

```bash
# Python backend
pip3 install mlx-whisper

# ffmpeg
brew install ffmpeg

# Pre-cache a model (whisper-turbo is the default; ~810 MB)
python3 -c "from huggingface_hub import snapshot_download; snapshot_download('mlx-community/whisper-turbo')"
```

---

## Install & run from source

```bash
git clone https://github.com/griffinwork40/whisper-app.git
cd whisper-app
npm install
npm run build
npm start
```

The tray icon appears in your menu bar. The default hotkey is **`⌥⌘`** (hold-to-talk). The first time you hold it, macOS will prompt for Microphone access (and Accessibility, if you've selected `autotype`).

---

## Configuration

Settings live at `~/Library/Application Support/whisper-app/config.json`:

```jsonc
{
  "hotkey": "Option+Cmd",                   // Electron accelerator string
  "model": "mlx-community/whisper-turbo",   // HuggingFace repo id
  "language": "en",                         // ISO 639-1 or "auto"
  "outputMode": "clipboard",                // "clipboard" | "autotype" | "both"
  "pythonPath": "python3",
  "tempDir": "/tmp"
}
```

### Hotkey modes

The hotkey string is parsed two ways:

- **Modifier-only** (e.g. `Option+Cmd`, `Alt`) → **hold-to-talk** via `uiohook-napi`. Press both modifiers to start; release any to stop. This is the default.
- **Regular accelerator** (e.g. `Control+Alt+Shift+D`) → **toggle** via Electron's `globalShortcut`. Press once to start, press again to stop.

> Recording is **hotkey-only by design**. Clicking the tray icon opens the context menu — it does not start a recording.

### Models

Anything from `mlx-community/*` that's already cached will work. The tray menu currently exposes:

- `whisper-tiny` (fastest, lowest quality)
- `whisper-turbo` (default)
- `whisper-large-v3-turbo`
- `whisper-large-v3-mlx`

---

## How it works

```
┌──────────────────────────────────────────────┐
│  Electron Main Process (TypeScript)          │
│  ├── Tray icon + context menu                │
│  ├── HotkeyManager (uiohook-napi | globalShortcut)
│  ├── AudioRecorder  ──► ffmpeg child-process │
│  │      writes → /tmp/whisper-<uuid>.wav     │
│  └── Transcriber                             │
│         python3 scripts/transcribe.py        │
│         → clipboard / AppleScript keystroke  │
└──────────────────────────────────────────────┘
```

1. Hotkey pressed → `ffmpeg` starts capturing 16 kHz mono PCM16 from the default input device.
2. Hotkey released → ffmpeg flushes the WAV.
3. `scripts/transcribe.py` is spawned with the WAV path and model id. It imports `mlx_whisper` and prints the transcript to stdout.
4. Transcript is delivered to clipboard and/or typed into the focused app.
5. Temp WAV is deleted.

No network calls at any point.

---

## Development

```bash
npm run build     # esbuild → dist/main.js + dist/test/
npm run dev       # build + start
npm test          # node --test dist/test/**/*.test.js
```

Source layout:

| Path | Responsibility |
|---|---|
| `src/main.ts` | Entry point; wires modules together |
| `src/tray.ts` | Menu-bar icon, context menu, state machine |
| `src/hotkey.ts` | Modifier-only (`uiohook-napi`) + accelerator (`globalShortcut`) |
| `src/recorder.ts` | `ffmpeg` child process → WAV |
| `src/transcriber.ts` | Spawn `transcribe.py`, return transcript |
| `src/output.ts` | Clipboard + AppleScript keystroke |
| `src/config.ts` | `electron-store` schema + getters |
| `src/startup.ts` | Arch / python / mlx_whisper / device / mic checks |
| `src/logger.ts` | Structured logger |
| `scripts/transcribe.py` | Python shim around `mlx_whisper.transcribe()` |

---

## Roadmap

- [ ] Code signing + notarization, ship a `.dmg`
- [ ] Streaming / partial transcription
- [ ] Per-app output-mode overrides
- [ ] Custom dictionary / replacement rules
- [ ] Settings UI (currently config file only beyond model + output mode)

---

## License

MIT — see [LICENSE](./LICENSE).

## Acknowledgements

- [`mlx-whisper`](https://github.com/ml-explore/mlx-examples/tree/main/whisper) (Apple)
- The original [`whisper-dictation`](https://github.com/foges/whisper-dictation) proved the concept in Python.

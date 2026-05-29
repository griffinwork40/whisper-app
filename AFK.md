# AFK.md — whisper-app

## What This Is

Local-only macOS menu-bar dictation app. Electron main-process-only (no renderer, no `BrowserWindow`) written in **TypeScript strict**, with a Python shim (`scripts/transcribe.py`) that calls `mlx-whisper` for on-device transcription. **Apple Silicon only.** Hardcoded to `/opt/homebrew/bin/ffmpeg`. No network calls at runtime — anything that phones home is out of scope. Source spec lives in `SPEC.md`; original plan in `PLAN.md`.

## Commands

```bash
npm install            # one-time
npm run build          # esbuild → dist/main.js + dist/test/*.js  (entry: esbuild.config.mjs)
npm start              # electron dist/main.js
npm run dev            # build + start
npm test               # node --test 'dist/test/**/*.test.js'  (must build first)
npx tsc --noEmit       # typecheck — run before pushing
```

CI (`.github/workflows/ci.yml`) runs on `macos-14` + Node 24: `tsc --noEmit` → `npm run build` → `npm test`. Tests do not invoke ffmpeg or python — they're pure unit tests.

## Architecture

Main-process-only Electron app. Single entry (`src/main.ts`) wires the modules below. State machine lives in `src/tray.ts` (`idle | recording | processing | error`). Shared types are defined in `src/types.ts` and **must be the first file other src/ files import from**.

| Path | Responsibility |
|---|---|
| `src/main.ts` | Entry point; wires modules together |
| `src/tray.ts` | Menu-bar icon, context menu, app state machine |
| `src/hotkey.ts` | Modifier-only (`uiohook-napi`) + accelerator (`globalShortcut`) |
| `src/recorder.ts` | `ffmpeg` child process → `/tmp/whisper-<uuid>.wav` (16kHz mono PCM16) |
| `src/transcriber.ts` | Spawn `scripts/transcribe.py`, return transcript |
| `src/output.ts` | Clipboard + AppleScript keystroke (autotype) |
| `src/config.ts` | `electron-store` schema (`~/Library/Application Support/whisper-app/config.json`) |
| `src/startup.ts` | Arch / python / `mlx_whisper` / ffmpeg / device / mic preflight checks |
| `src/logger.ts` | Structured logger — use this, not `console.*` |
| `src/types.ts` | `AppState`, `OutputMode`, `HotkeyMode`, `ModelId`, error classes |
| `scripts/transcribe.py` | Python shim around `mlx_whisper.transcribe()` |
| `test/*.test.ts` | Unit tests (`node --test`) |

Runtime deps (kept minimal — adding one needs justification): `electron`, `electron-store`, `uiohook-napi`. Build tools: `esbuild`, `typescript`. Externals at bundle time: `electron`, `uiohook-napi` (native modules — not bundled).

## Conventions

- **TypeScript strict mode.** `tsconfig.json` is the source of truth (`strict: true`, target `ES2022`, module `commonjs`). Do not weaken it.
- **No telemetry, no network calls at runtime.** Discuss in an issue first if a change requires either.
- **No renderer process, no `BrowserWindow`.** Main-process-only by design.
- **Stable contracts (additive-only):** `config.json` schema, tray-menu event names, `VALID_MODELS` / `VALID_HOTKEY_MODES` / `VALID_OUTPUT_MODES` in `src/types.ts`.
- **Logging:** `logger.info/warn/error/debug`, never `console.*`.
- **Adding a model:** new entry in `VALID_MODELS` (`src/types.ts`) + rebuild. Tray menu reads from there.
- **System dependencies are preflight-checked** in `src/startup.ts` — keep that file and the README in sync. `ffmpeg` path is currently hardcoded to `/opt/homebrew/bin/ffmpeg`.
- **Hotkey modes:** `hold` requires a modifier-only accelerator (Electron can't observe key-release on standard accelerators); `tap` works for any. The hold→tap fallback path is implemented in `src/hotkey.ts`.
- **PRs:** small + focused. CI must be green. Manual test plan (recording → transcript → clipboard) lives in `CONTRIBUTING.md`.

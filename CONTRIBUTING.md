# Contributing to Whisper App

Thanks for your interest! This is an early-stage project, so contributions of any size are welcome — bug reports, doc fixes, tests, refactors, or new features.

## Ground rules

- **Apple Silicon only.** The app shells out to `mlx-whisper`, which is MLX-backed and Apple-Silicon-only. Cross-platform PRs are out of scope for v0.
- **No telemetry / no network calls at runtime.** Anything that phones home (analytics, crash reporters, model downloaders) needs explicit discussion in an issue first.
- **Keep dependencies lean.** The current runtime deps are `electron`, `electron-store`, `uiohook-napi`. Adding a new one needs justification.
- **TypeScript strict mode.** `tsconfig.json` is the source of truth; do not weaken it.

## Project layout

| Path | Responsibility |
|---|---|
| `src/main.ts` | Electron entry point; wires modules together |
| `src/tray.ts` | Menu-bar icon, context menu, state machine |
| `src/hotkey.ts` | Modifier-only (`uiohook-napi`) + accelerator (`globalShortcut`) |
| `src/recorder.ts` | `ffmpeg` child process → WAV |
| `src/transcriber.ts` | Spawn `transcribe.py`, return transcript |
| `src/output.ts` | Clipboard + AppleScript keystroke |
| `src/config.ts` | `electron-store` schema + getters |
| `src/startup.ts` | Arch / python / mlx_whisper / device / mic checks |
| `src/logger.ts` | Structured logger |
| `scripts/transcribe.py` | Python shim around `mlx_whisper.transcribe()` |
| `test/*.test.ts` | Unit tests (`node --test`) |
| `SPEC.md` | Design spec — read this before substantial changes |
| `PLAN.md` | Original implementation plan |

## Dev loop

```bash
# One-time
npm install

# Build + start
npm run build
npm start            # or: npm run dev (build + start)

# Tests (40 unit tests today)
npm test
```

Tests live in `test/` (TypeScript) and are compiled by `esbuild` into `dist/test/` then run via `node --test`. No mocha, no jest.

### Manual test plan

Some behavior is hard to unit-test because it requires real audio hardware, the microphone permission, or a running Electron app. Before submitting a PR that touches recording, transcription, or hotkeys, please verify by hand:

1. App launches (tray icon appears, no Dock icon).
2. Default hotkey (`⌥⌘`) starts a recording (tray icon turns red).
3. Releasing the hotkey stops the recording and transitions to "processing".
4. Transcript appears on the clipboard within ~5s for a 10s clip.
5. Clicking the tray icon shows the context menu and does **not** start a recording.
6. Quitting via the tray menu fully exits the process (no orphaned `ffmpeg` or python).

## System dependencies (gotchas)

These are checked at startup by `src/startup.ts` — if you change any, update both the check and the README:

- `ffmpeg` is currently hardcoded to `/opt/homebrew/bin/ffmpeg` (Homebrew on Apple Silicon). Making this configurable is a welcome PR.
- `python3` is resolved via `which python3` on the user's PATH. The resolved path is passed to the `Transcriber`.
- The model id list lives in `src/types.ts` (`VALID_MODELS`). Adding a model requires an entry there and a re-build.

## Style

- Run `npx tsc --noEmit` before pushing. CI also runs `npm test` + `npm run build`.
- Prefer additive, backward-compatible changes (especially to `config.json` schema and tray-menu event names — they're stable contracts).
- Use `logger.info / warn / error / debug` instead of `console.*`.
- Don't introduce a renderer process or `BrowserWindow`. This is a main-process-only app by design.

## Filing an issue

Useful information:

- macOS version (`sw_vers`)
- Output of `node --version`, `python3 --version`, `python3 -c "import mlx_whisper; print(mlx_whisper.__version__)"`, `ffmpeg -version | head -1`
- Tray icon state when the issue happened (idle / recording / processing / error)
- Relevant lines from the Electron logger (stdout — run `npm start` from a terminal to see them)

## Pull requests

1. Fork the repo, branch from `main`.
2. Make the change. Add or update tests where reasonable.
3. Run `npm run build && npm test`.
4. Open a PR describing **what** changed and **why**, plus how you verified it (CI + your manual test notes).
5. Small, focused PRs land faster than sweeping ones.

By submitting a PR, you agree your contribution is licensed under the project's [MIT License](./LICENSE).

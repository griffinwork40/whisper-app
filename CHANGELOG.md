# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- `customVocabulary` config field — passed to Whisper as `initial_prompt` to bias transcription toward custom vocabulary, proper nouns, or a punctuation/style hint (config-file only, no tray UI yet).
- `replacementRules` config field — literal, case-sensitive find/replace pairs applied to the transcript before delivery, for words the model reliably mangles the same way every time.

## [0.1.0] — 2026-05-21

Initial public release.

### Added
- Menu-bar tray app with idle / recording / processing / error icon states.
- Hold-to-talk hotkey (default `Option+Cmd`) via `uiohook-napi`.
- Toggle hotkey support for non-modifier accelerators via Electron `globalShortcut`.
- ffmpeg-backed audio capture (16 kHz mono PCM16) to `/tmp`.
- On-device transcription via `mlx_whisper` Python child process.
- Output modes: clipboard, auto-type (AppleScript `System Events`), or both.
- Tray menu for model and output-mode selection; settings persisted via `electron-store`.
- Startup checks: arm64 arch, `python3`, `mlx_whisper` import, ffmpeg device enumeration, microphone permission.
- 40 passing unit tests (`node --test`).
- Recording is hotkey-only by design — clicking the tray icon opens the context menu instead.

### Known limitations
- Apple Silicon only.
- ffmpeg path is hardcoded to `/opt/homebrew/bin/ffmpeg`.
- Not code-signed or notarized; install from source.
- Batch transcription only (no streaming).
- No settings UI beyond the tray menu — advanced options require editing `~/Library/Application Support/whisper-app/config.json`.

[Unreleased]: https://github.com/griffinwork40/whisper-app/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/griffinwork40/whisper-app/releases/tag/v0.1.0

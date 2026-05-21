# Implementation Plan: whisper-app

**Type:** Greenfield — Node.js + TypeScript + Electron macOS menu-bar dictation app  
**Date:** 2025-05-11  
**Derived from:** `SPEC.md` + Research Brief  
**Estimated scope:** ~12 source files, 1 Python helper, ~750 LOC TypeScript

---

## 1. File Inventory

### New files to create (grouped by layer)

#### Project scaffolding
| File | Action | Description |
|---|---|---|
| `package.json` | **Create** | npm manifest: `electron@36`, `electron-store@11`, `typescript`, `esbuild`, `@types/node`. Scripts: `build`, `start`, `dev`. |
| `tsconfig.json` | **Create** | Target `ES2022`, `module: commonjs`, `moduleResolution: node`, `strict: true`, `outDir: dist`. |
| `.gitignore` | **Create** | Standard Node + Electron ignores (`node_modules/`, `dist/`, `*.js.map`). |
| `esbuild.config.mjs` | **Create** | esbuild script: `--platform=node --target=node22 --external:electron --bundle --outfile=dist/main.js src/main.ts`. |

#### Python helper
| File | Action | Description |
|---|---|---|
| `scripts/transcribe.py` | **Create** | Standalone Python script. Accepts `--model`, `--language`, `--audio` args. Calls `mlx_whisper.transcribe()` with `verbose=False`. Prints `{"text": "..."}` JSON to stdout on success or `{"error": "..."}` on failure. Exit code 0/1. |

#### Source modules (`src/`)
| File | Action | Description |
|---|---|---|
| `src/main.ts` | **Create** | Electron entry point. Calls `app.dock.hide()`, `app.requestSingleInstanceLock()`, runs startup checks, wires `Tray`, `Hotkey`, `Recorder`, `Transcriber`, `Output`. Owns the top-level state machine. |
| `src/tray.ts` | **Create** | `Tray` wrapper. Manages icon state (`idle` / `recording` / `processing` / `error`). Builds context menu with model picker, output mode toggle, quit. Emits `'toggle'` event. Exports `TrayManager` class. |
| `src/hotkey.ts` | **Create** | Thin wrapper around `globalShortcut`. `register(accelerator, callback)` / `unregister()`. Logs if registration fails. |
| `src/recorder.ts` | **Create** | `AudioRecorder` class. `start()` spawns ffmpeg with enumerated device index, writes to `os.tmpdir()/whisper-<uuid>.wav`. `stop()` sends SIGTERM to ffmpeg, resolves a Promise with the WAV file path. Cleans up on error. |
| `src/transcriber.ts` | **Create** | `Transcriber` class. `transcribe(wavPath, model, language)` spawns `python3 scripts/transcribe.py`, parses JSON stdout, returns `string`. Deletes WAV in `finally`. Throws typed `TranscriptionError` on non-zero exit. |
| `src/output.ts` | **Create** | `writeToClipboard(text)` and `autotype(text)` (via `osascript`). `deliver(text, mode)` dispatches based on config `outputMode`. Clipboard is always the fallback if autotype fails. |
| `src/config.ts` | **Create** | `Config` class backed by `electron-store`. Schema with defaults for all fields. Typed getter/setter. Validates `outputMode`, `model` against known values. |
| `src/logger.ts` | **Create** | Lightweight logger writing to stdout and `~/Library/Logs/whisper-app/app.log`. Levels: `debug`, `info`, `warn`, `error`. No external dependency. |
| `src/startup.ts` | **Create** | `runStartupChecks()`: (1) verify Apple Silicon via `process.arch === 'arm64'`, (2) resolve Python path via `which python3`, (3) verify `import mlx_whisper` works, (4) enumerate ffmpeg audio devices and cache default device index, (5) request mic permission. Returns `StartupResult` or throws `SetupError` with a user-facing message. |
| `src/types.ts` | **Create** | Shared TypeScript types and enums: `AppState`, `OutputMode`, `ModelId`, `TranscriptionError`, `SetupError`, `StartupResult`, `DeviceInfo`. |

#### Assets
| File | Action | Description |
|---|---|---|
| `assets/icon-idle.png` | **Create** | 22×22 px tray icon — microphone, neutral state. Template image (black on transparent). |
| `assets/icon-recording.png` | **Create** | 22×22 px tray icon — microphone, active/red dot indicator. |
| `assets/icon-processing.png` | **Create** | 22×22 px tray icon — waveform / spinner frame (used during animation). |
| `assets/icon-error.png` | **Create** | 22×22 px tray icon — microphone with X. |

#### Tests (`test/`)
| File | Action | Description |
|---|---|---|
| `test/config.test.ts` | **Create** | Unit tests for `Config`: default values, get/set round-trip, persistence, schema validation rejections. |
| `test/recorder.test.ts` | **Create** | Unit tests for `AudioRecorder`: ffmpeg command construction, temp path format, cleanup on failure. Uses process spawn mocking. |
| `test/transcriber.test.ts` | **Create** | Unit tests for `Transcriber`: JSON stdout parsing, error path on non-zero exit, WAV cleanup in `finally`. |
| `test/output.test.ts` | **Create** | Unit tests for `Output`: clipboard write, autotype osascript command shape, fallback logic. |
| `test/startup.test.ts` | **Create** | Unit tests for `runStartupChecks()`: device enumeration regex against fixture strings, Python resolution logic. |
| `test/transcribe.py.test.sh` | **Create** | Bash smoke test for the Python helper: runs it against a real WAV fixture and asserts JSON `text` key is present. |

---

## 2. Implementation Order (Sequential Dependencies)

### Wave 0 — Foundation (must be done first, everything depends on this)
1. `package.json` — defines the runtime; nothing else can be installed without it
2. `tsconfig.json` — TypeScript compiler config; tests and source files require it
3. `.gitignore`, `esbuild.config.mjs` — scaffolding, no dependencies
4. `src/types.ts` — shared type definitions imported by every other module

### Wave 1 — Leaf modules (no imports from other `src/` modules)
These can be implemented in **parallel** after Wave 0:
- `src/logger.ts` — only imports Node built-ins (`fs`, `path`, `os`)
- `src/config.ts` — imports `electron-store` and `src/types.ts`
- `src/output.ts` — imports `child_process`, `electron.clipboard`, `src/types.ts`
- `scripts/transcribe.py` — pure Python, no Node dependency

### Wave 2 — Mid-layer modules (depend on Wave 1)
These can be implemented in **parallel** after Wave 1:
- `src/startup.ts` — imports `logger`, `config`, `types`; needs device enumeration logic finalized
- `src/recorder.ts` — imports `logger`, `types`; needs the device index interface from `startup.ts` to be known
- `src/transcriber.ts` — imports `logger`, `types`; needs `scripts/transcribe.py` to exist (Wave 1)

### Wave 3 — UI layer (depend on Wave 2)
- `src/hotkey.ts` — thin Electron wrapper, imports `types`, `logger`
- `src/tray.ts` — imports `config`, `logger`, `types`; emits events consumed by `main.ts`

### Wave 4 — Entry point + assets (depend on everything)
- `src/main.ts` — wires all modules; implemented last
- `assets/icon-*.png` — can be created any time but must exist before `main.ts` is tested

### Wave 5 — Tests (written alongside or just before each implementation)
> **TDD approach:** write each test file before or concurrent with its corresponding source file. The test defines the interface contract; implementation makes it pass.

- `test/config.test.ts` — write before `src/config.ts`
- `test/output.test.ts` — write before `src/output.ts`
- `test/recorder.test.ts` — write before `src/recorder.ts`
- `test/transcriber.test.ts` — write before `src/transcriber.ts`
- `test/startup.test.ts` — write before `src/startup.ts`
- `test/transcribe.py.test.sh` — write before `scripts/transcribe.py`

---

## 3. Detailed Implementation Notes Per File

### `scripts/transcribe.py`
```
CLI args: --audio <path> --model <hf-repo-id> [--language <lang>]
stdout on success:  {"text": "Hello world"}
stdout on failure:  {"error": "No module named mlx_whisper"}
exit code: 0 success, 1 failure
```
- Use `sys.stderr` for debug/progress noise so stdout stays clean JSON
- Redirect all `mlx_whisper` verbose output to `stderr` with `verbose=False`
- Wrap entire body in `try/except Exception as e: print(json.dumps({"error": str(e)})); sys.exit(1)`

### `src/startup.ts` — Device Enumeration
```typescript
// Run: ffmpeg -f avfoundation -list_devices true -i ""
// Parse stderr for lines between "AVFoundation audio devices:" header
// and either end-of-output or "AVFoundation video devices:" (second section never appears after audio)
// Regex: /\[(\d+)\] (.+)/ after the audio header line
// Prefer device matching /MacBook Pro Microphone/ as default, fallback to index 0
```

### `src/recorder.ts` — ffmpeg Command
```
/opt/homebrew/bin/ffmpeg
  -f avfoundation
  -i none:<deviceIndex>
  -ar 16000
  -ac 1
  -acodec pcm_s16le
  -y
  <tempDir>/whisper-<uuid>.wav
```
- `start()` returns `void`, stores the ChildProcess reference
- `stop()` returns `Promise<string>` (resolves with WAV path on ffmpeg exit)
- Handle SIGTERM → ffmpeg finalizes WAV header before exiting (this is expected behavior)
- Set a 60-second max recording guard (auto-stop)

### `src/tray.ts` — State Machine
```
States: idle → recording → processing → idle
                                      → error → idle (after 3s)
Icon animation during "processing": setInterval cycling icon-processing frames at 150ms
```

### `src/transcriber.ts` — Subprocess
```typescript
// Spawn: python3 scripts/transcribe.py --audio <wav> --model <model> --language <lang>
// Use full Python path resolved at startup
// stdout: JSON parse → result.text
// stderr: pipe to logger.debug
// Timeout: 30 seconds (kill process if exceeded, throw TranscriptionError)
// finally: unlink(wavPath) — always
```

### `src/output.ts` — AppleScript
```applescript
tell application "System Events" to keystroke "<text>"
```
- Shell escape the text (no raw string interpolation — use `execFile('osascript', ['-e', script])`)
- Clipboard always written first, then autotype attempted if mode requires it
- If `isTrustedAccessibilityClient(false)` returns false, skip autotype + show notification

### `src/main.ts` — Top-level Flow
```
app.whenReady():
  1. app.dock.hide()
  2. requestSingleInstanceLock() or quit
  3. await runStartupChecks() — show error notification + quit on SetupError
  4. new TrayManager(config)
  5. hotkey.register(config.hotkey, onToggle)
  6. tray.on('toggle', onToggle)
  7. tray.on('quit', () => app.quit())

onToggle():
  if state === 'idle':     startRecording()
  if state === 'recording': stopAndTranscribe()

stopAndTranscribe():
  tray.setState('processing')
  wavPath = await recorder.stop()
  try:
    text = await transcriber.transcribe(wavPath, config.model, config.language)
    await output.deliver(text, config.outputMode)
    tray.setState('idle')
  catch (err):
    tray.setState('error')
    new Notification({ title: 'Transcription failed', body: err.message }).show()
```

---

## 4. Test Plan

### Testing framework
Use **Node.js built-in test runner** (`node:test` + `assert`) — available since Node 18, no extra install needed. Run with `node --test dist/test/**/*.test.js` after esbuild compilation.

### What each test validates

| Test file | Key assertions |
|---|---|
| `test/config.test.ts` | Default values match schema; `setModel()` persists; unknown model rejected; config survives simulated restart (re-instantiation from same store path) |
| `test/recorder.test.ts` | `buildFfmpegArgs(deviceIndex, outPath)` produces correct arg array; temp path matches `/whisper-[a-z0-9]+\.wav$/`; cleanup called on mock ffmpeg non-zero exit |
| `test/transcriber.test.ts` | JSON `{"text":"hello"}` stdout → returns `"hello"`; `{"error":"..."}` stdout + exit 1 → throws `TranscriptionError`; WAV unlink called in both success and error paths |
| `test/output.test.ts` | `writeToClipboard` calls `electron.clipboard.writeText`; `autotype` builds correct osascript `-e` arg; `deliver('both')` calls both; accessibility check gates autotype |
| `test/startup.test.ts` | Device enumeration regex correctly extracts `[0] Griffin 13 Pro Max Microphone` → `{index:0, name:'Griffin 13 Pro Max Microphone'}`; prefers `/MacBook Pro Microphone/`; fallback to index 0 when no match |
| `test/transcribe.py.test.sh` | Script exits 0; stdout is valid JSON; `text` key is non-empty string (requires real WAV fixture at `test/fixtures/hello.wav`) |

### Test fixtures needed
- `test/fixtures/ffmpeg-device-list.txt` — captured `ffmpeg -list_devices` stderr output (copy from this machine's output)
- `test/fixtures/hello.wav` — 1-second 16kHz mono WAV of spoken "hello" for the Python smoke test

---

## 5. Verification Commands

Run these in order after implementation:

```bash
# 1. Install dependencies
npm install

# 2. Type-check (zero errors required)
npx tsc --noEmit

# 3. Build
npm run build
# Expected: dist/main.js exists, no esbuild errors

# 4. Run unit tests
node --test 'dist/test/**/*.test.js'
# Expected: all tests pass, 0 failures

# 5. Python helper smoke test (requires mlx_whisper + a real WAV)
bash test/transcribe.py.test.sh
# Expected: exit 0, output contains {"text": ...}

# 6. Launch the app (manual verification)
npm start
# Expected:
#   - No Dock icon appears
#   - Tray icon appears in menu bar
#   - ⌥Space triggers recording (red icon)
#   - Second ⌥Space triggers transcription
#   - Text appears on clipboard within 5 seconds

# 7. Memory check (after startup, before any transcription)
ps aux | grep -i electron | grep -v grep | awk '{print $6}'
# Expected: RSS ≤ 204800 (200 MB in KB)
```

---

## 6. Potential Blockers

| Risk | Severity | Mitigation |
|---|---|---|
| **Electron 36 + macOS 26 Tahoe compatibility** | Medium | If tray or globalShortcut APIs behave differently on Darwin 25.x, try `electron@37` (latest 37.10.3 confirmed available). Pin exact version in `package.json` `"electron": "36.x.x"`. |
| **ffmpeg `none:<index>` format** | Low | Confirmed working format from research. Always use `/opt/homebrew/bin/ffmpeg` absolute path since Electron subprocesses don't inherit shell PATH. |
| **Python path in Electron subprocess** | Medium | `startup.ts` resolves Python path via `which python3` before any spawning. Store resolved path at module level (`/opt/homebrew/bin/python3`). Never rely on `PATH` lookup in spawned processes. |
| **`globalShortcut` requires app focus event loop** | Low | Must call `globalShortcut.register` inside `app.whenReady()`. Already accounted for in `main.ts` flow. `Option+Space` is confirmed not reserved by macOS. Modifier-only chords (e.g. `Option+Cmd`) are also supported via uiohook-napi hold-to-talk. |
| **Microphone permission timing** | Medium | `askForMediaAccess('microphone')` is async and shows a system dialog. Must `await` it in `startup.ts` before spawning ffmpeg. On first run, recording attempt before permission is granted will fail silently — guard with permission check in `recorder.start()`. |
| **`electron-store` ESM/CJS mismatch** | Low | `electron-store@11` is ESM-only. esbuild handles this with `--format=cjs` since we're targeting Node CommonJS. Verify with a quick import test during initial scaffolding. |
| **tray icon sizing on macOS 26** | Low | Use 22×22 px at 1x; Electron will handle Retina (44×44 @2x) if you supply an `@2x` suffixed file. Can use text emoji as placeholder icon during development to unblock UI work. |
| **AppleScript keystroke with special characters** | Low | Long transcripts with quotes, apostrophes, or Unicode may trip up naive `keystroke`. Use `System Events keystroke` with properly escaped strings via `execFile` (not `exec`) to avoid shell interpolation bugs. |

---

## 7. Implementation Summary

```
Wave 0: package.json, tsconfig.json, .gitignore, esbuild.config.mjs, src/types.ts
  ↓
Wave 1: src/logger.ts, src/config.ts, src/output.ts, scripts/transcribe.py  [parallel]
  ↓
Wave 2: src/startup.ts, src/recorder.ts, src/transcriber.ts               [parallel]
  ↓
Wave 3: src/hotkey.ts, src/tray.ts                                         [parallel]
  ↓
Wave 4: src/main.ts, assets/icon-*.png
  ↓
Wave 5: All test files, test fixtures, bash smoke test
  ↓
Verify: tsc --noEmit → npm run build → node --test → npm start
```

**Total new files:** 24 (12 TypeScript source, 1 Python helper, 4 PNG assets, 4 esbuild/tsconfig/npm scaffolding, 3 test fixtures/scripts)  
**External npm dependencies:** `electron@36`, `electron-store@11`, `typescript`, `esbuild`, `@types/node`  
**Zero native addons.** All audio I/O via ffmpeg subprocess. All ML inference via Python subprocess.

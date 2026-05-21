# Whisper App — Orchestration Plan
**Derived from:** `PLAN.md` + `SPEC.md`  
**Strategy:** Dependency-aware parallel waves; TDD embedded per lane; each wave is a discrete sub-agent dispatch boundary.

---

## Goal

Build `whisper-app`: a TypeScript + Electron macOS menu-bar dictation app that captures microphone audio via ffmpeg, transcribes locally using `mlx_whisper`, and delivers text to clipboard or auto-types via AppleScript. No Dock icon. No renderer/BrowserWindow. No native Node addons.

**24 total files** across TypeScript source, Python helper, assets, tests, and scaffolding.

---

## Dependency Graph (visual)

```
Wave 0 ─────────────────────────────────────────────────────────────────
  package.json  tsconfig.json  esbuild.config.mjs  .gitignore  src/types.ts
        │               │               │                │           │
        └───────────────┴───────────────┴────────────────┴───────────┘
                                        │
                                        ▼
Wave 1 ─────────────────────────────────────────────────────────────────
  [A] src/logger.ts          [B] src/config.ts
  [A] src/output.ts          [B] scripts/transcribe.py
  (A = no intra-src imports; B = imports types.ts only)
  tests written in this wave: test/config.test.ts, test/output.test.ts,
                               test/transcribe.py.test.sh
                                        │
                                        ▼
Wave 2 ─────────────────────────────────────────────────────────────────
  [C] src/startup.ts         [C] src/recorder.ts       [C] src/transcriber.ts
  (C = imports from Wave 1 modules + types.ts)
  tests written in this wave: test/startup.test.ts, test/recorder.test.ts,
                               test/transcriber.test.ts
  fixtures created: test/fixtures/ffmpeg-device-list.txt, test/fixtures/hello.wav
                                        │
                                        ▼
Wave 3 ─────────────────────────────────────────────────────────────────
  [D] src/hotkey.ts          [D] src/tray.ts
  (D = imports from Wave 1 + Wave 2 + types.ts)
                                        │
                                        ▼
Wave 4 ─────────────────────────────────────────────────────────────────
  src/main.ts   assets/icon-idle.png   assets/icon-recording.png
                assets/icon-processing.png  assets/icon-error.png
                                        │
                                        ▼
Wave 5 ─────────────────────────────────────────────────────────────────
  npm install → npx tsc --noEmit → npm run build → node --test → bash smoke test
```

---

## Parallelization Rules

| Rule | Rationale |
|---|---|
| **Never parallelize across waves** | Each wave has compile-time and runtime dependencies on the previous wave's outputs |
| **Always parallelize within a wave** | Files within a wave share no intra-wave imports; they are safe to build concurrently |
| **Tests run in their own wave (Wave 5)** | All source + assets must be fully compiled before the test runner can execute |
| **Assets are independent of TypeScript** | `assets/icon-*.png` can be created in any wave ≥ Wave 0 but must exist before Wave 5 |
| **Do not parallelize `package.json` + `npm install`** | `npm install` must complete before any TypeScript tooling is available |

---

## Wave 0 — Project Scaffolding
**Gate:** Nothing else starts until this wave is fully complete and `npm install` succeeds.  
**Parallelizable within wave:** Yes — all five files can be written simultaneously.  
**Sub-agent count:** 1 (sequential within this wave due to `npm install` sequencing)

### Files

#### `package.json`
```json
{
  "name": "whisper-app",
  "version": "0.1.0",
  "description": "Local macOS menu-bar dictation app",
  "main": "dist/main.js",
  "scripts": {
    "build": "node esbuild.config.mjs",
    "start": "electron dist/main.js",
    "dev": "npm run build && npm start",
    "test": "node --test 'dist/test/**/*.test.js'"
  },
  "dependencies": {
    "electron": "36.x.x",
    "electron-store": "11.x.x"
  },
  "devDependencies": {
    "typescript": "^5.4.0",
    "esbuild": "^0.21.0",
    "@types/node": "^22.0.0"
  }
}
```
- Pin `electron` to `36.x.x` (macOS 26 Tahoe compatible, ships Node 22 types).  
- Fallback version if 36.x.x has Tahoe issues: `37.10.3`.

#### `tsconfig.json`
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "moduleResolution": "node",
    "strict": true,
    "outDir": "dist",
    "rootDir": ".",
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*", "test/**/*"]
}
```

#### `esbuild.config.mjs`
- Bundle `src/main.ts` → `dist/main.js`
- Also bundle each `test/*.test.ts` → `dist/test/*.test.js`
- Flags: `--platform=node --target=node22 --external:electron --format=cjs --bundle`
- The `--format=cjs` flag handles `electron-store@11` ESM/CJS boundary.

#### `.gitignore`
Standard Node + Electron ignores: `node_modules/`, `dist/`, `*.js.map`, `.DS_Store`, `*.log`.

#### `src/types.ts`
Shared types that every module imports. Define **before** writing any other `src/` file:
```typescript
export type AppState = 'idle' | 'recording' | 'processing' | 'error';
export type OutputMode = 'clipboard' | 'autotype' | 'both';
export type ModelId = 
  | 'mlx-community/whisper-tiny'
  | 'mlx-community/whisper-turbo'
  | 'mlx-community/whisper-large-v3-turbo'
  | 'mlx-community/whisper-large-v3-mlx';

export class TranscriptionError extends Error {
  constructor(message: string, public readonly exitCode: number) {
    super(message);
    this.name = 'TranscriptionError';
  }
}

export class SetupError extends Error {
  constructor(message: string, public readonly userMessage: string) {
    super(message);
    this.name = 'SetupError';
  }
}

export interface StartupResult {
  pythonPath: string;
  deviceIndex: number;
  deviceName: string;
}

export interface DeviceInfo {
  index: number;
  name: string;
}
```

### Wave 0 Completion Gate
```bash
npm install           # must exit 0
npx tsc --noEmit      # types.ts must pass type-check in isolation (no errors)
```

---

## Wave 1 — Leaf Modules
**Prerequisite:** Wave 0 complete; `node_modules/` populated; `src/types.ts` exists.  
**Parallelizable within wave:** YES — all four source files + three test files share no intra-`src/` imports.  
**Sub-agent count:** Up to 4 parallel agents (one per source file + co-located test).

### Lane 1-A: `src/logger.ts`
**No tests required** (pure side-effect I/O; tested implicitly via integration).

Contract:
```typescript
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export function debug(msg: string, ...args: unknown[]): void;
export function info(msg: string, ...args: unknown[]): void;
export function warn(msg: string, ...args: unknown[]): void;
export function error(msg: string, ...args: unknown[]): void;
```
- Write to `process.stdout` (structured: `[ISO-timestamp] [LEVEL] msg`)
- Append to `~/Library/Logs/whisper-app/app.log` via `fs.appendFileSync`
- Create log directory with `fs.mkdirSync(..., { recursive: true })` on module load
- Zero external dependencies (Node built-ins: `fs`, `path`, `os` only)

### Lane 1-B: `src/config.ts` + `test/config.test.ts` (TDD)
**Write `test/config.test.ts` FIRST. Implementation makes it pass.**

Test contract (`test/config.test.ts`):
```typescript
// node:test + assert
// 1. Defaults: model === 'mlx-community/whisper-turbo', outputMode === 'clipboard', hotkey === 'Option+Space'
// 2. set/get round-trip: setModel('mlx-community/whisper-tiny') → getModel() === 'mlx-community/whisper-tiny'
// 3. Persistence: new Config() after set still returns updated value
// 4. Invalid model rejected: setModel('fake-model') throws TypeError
// 5. Invalid outputMode rejected: setOutputMode('invalid') throws TypeError
```

Implementation (`src/config.ts`):
- Backed by `electron-store@11`
- Schema with typed defaults for: `hotkey`, `model`, `language`, `outputMode`
- Guard setters with type-narrowing checks against `ModelId` and `OutputMode` unions
- Export: `class Config { getModel, setModel, getOutputMode, setOutputMode, getHotkey, getLanguage }`

### Lane 1-C: `src/output.ts` + `test/output.test.ts` (TDD)
**Write `test/output.test.ts` FIRST. Implementation makes it pass.**

Test contract (`test/output.test.ts`):
```typescript
// 1. writeToClipboard calls electron.clipboard.writeText with correct string
// 2. autotype builds osascript -e with 'tell application "System Events" to keystroke "..."'
// 3. deliver('both', text) calls both writeToClipboard AND autotype
// 4. deliver('clipboard', text) calls only writeToClipboard, not autotype
// 5. If isTrustedAccessibilityClient returns false, autotype is skipped; clipboard still written
// Mock: electron.clipboard.writeText, child_process.execFile, systemPreferences.isTrustedAccessibilityClient
```

Implementation (`src/output.ts`):
- `writeToClipboard(text: string): void` — calls `electron.clipboard.writeText(text)`
- `autotype(text: string): Promise<void>` — calls `execFile('osascript', ['-e', script])` where script is `tell application "System Events" to keystroke "${escaped}"`. Use `execFile` (NOT `exec`) to avoid shell interpolation.
- Always write to clipboard first; autotype is additive
- Gate autotype on `systemPreferences.isTrustedAccessibilityClient(false)`
- `deliver(text: string, mode: OutputMode): Promise<void>`

### Lane 1-D: `scripts/transcribe.py` + `test/transcribe.py.test.sh` (TDD)
**Write `test/transcribe.py.test.sh` FIRST (defines the interface). Script makes it pass.**

Test contract (`test/transcribe.py.test.sh`):
```bash
#!/usr/bin/env bash
# Requires: mlx_whisper installed, test/fixtures/hello.wav exists
set -e
RESULT=$(python3 scripts/transcribe.py --audio test/fixtures/hello.wav --model mlx-community/whisper-tiny --language en)
echo "$RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); assert 'text' in d and isinstance(d['text'], str) and len(d['text']) > 0, f'Bad output: {d}'"
echo "PASS: transcribe.py smoke test"
```

Implementation (`scripts/transcribe.py`):
```python
#!/usr/bin/env python3
# CLI: --audio <path> --model <hf-repo-id> [--language <lang>]
# stdout success: {"text": "..."}
# stdout failure: {"error": "..."}
# exit code: 0 / 1
import argparse, json, sys
try:
    import mlx_whisper
    parser = argparse.ArgumentParser()
    parser.add_argument('--audio', required=True)
    parser.add_argument('--model', required=True)
    parser.add_argument('--language', default='en')
    args = parser.parse_args()
    result = mlx_whisper.transcribe(args.audio, path_or_hf_repo=args.model,
                                     language=args.language, verbose=False)
    print(json.dumps({"text": result["text"].strip()}))
    sys.exit(0)
except Exception as e:
    print(json.dumps({"error": str(e)}))
    sys.exit(1)
```
- All `mlx_whisper` progress/verbose noise goes to stderr (`verbose=False`)
- Wrap entire body in `try/except` — structured JSON on both paths
- Note: `python3 -m mlx_whisper` is unreliable inside Electron subprocesses; this script is the authoritative invocation path

### Wave 1 Completion Gate
```bash
npx tsc --noEmit    # all Wave 1 source files must type-check cleanly
npm run build       # esbuild must compile test files to dist/test/
node --test 'dist/test/config.test.js'
node --test 'dist/test/output.test.js'
# transcribe.py.test.sh deferred to Wave 5 (needs hello.wav fixture)
```

---

## Wave 2 — Mid-Layer Modules
**Prerequisite:** Wave 1 complete; `logger.ts`, `config.ts`, `output.ts`, `transcribe.py` all exist.  
**Parallelizable within wave:** YES — `startup.ts`, `recorder.ts`, `transcriber.ts` have no intra-wave imports.  
**Sub-agent count:** Up to 3 parallel agents.

### Lane 2-A: `src/startup.ts` + `test/startup.test.ts` + `test/fixtures/ffmpeg-device-list.txt` (TDD)
**Write test + fixture FIRST.**

Fixture (`test/fixtures/ffmpeg-device-list.txt`):
```
AVFoundation video devices:
[0] FaceTime HD Camera
AVFoundation audio devices:
[0] Griffin 13 Pro Max Microphone
[1] MacBook Pro Microphone
[2] ZoomAudioDevice
```

Test contract (`test/startup.test.ts`):
```typescript
// 1. parseDevices(fixtureText) returns [{index:0, name:'Griffin 13 Pro Max Microphone'},
//                                        {index:1, name:'MacBook Pro Microphone'},
//                                        {index:2, name:'ZoomAudioDevice'}]
// 2. selectDevice(devices) prefers device matching /MacBook Pro Microphone/ → index 1
// 3. selectDevice([{index:0, name:'Other Mic'}]) falls back to index 0 when no match
// 4. parseDevices with no audio section returns []
// Export parseDevices and selectDevice as named exports for testability
```

Implementation (`src/startup.ts`):
```typescript
export async function runStartupChecks(): Promise<StartupResult>
export function parseDevices(ffmpegStderr: string): DeviceInfo[]   // exported for tests
export function selectDevice(devices: DeviceInfo[]): DeviceInfo    // exported for tests
```
- Step 1: `process.arch === 'arm64'` check → throw `SetupError` if not
- Step 2: `which python3` via `execFile` → store absolute path
- Step 3: spawn `python3 -c "import mlx_whisper"` → throw `SetupError` if non-zero
- Step 4: spawn `ffmpeg -f avfoundation -list_devices true -i ""` → parse **stderr** (not stdout) for `AVFoundation audio devices:` section; regex `/\[(\d+)\] (.+)/`
- Step 5: `systemPreferences.askForMediaAccess('microphone')` → throw `SetupError` if denied

### Lane 2-B: `src/recorder.ts` + `test/recorder.test.ts` (TDD)
**Write `test/recorder.test.ts` FIRST.**

Test contract (`test/recorder.test.ts`):
```typescript
// 1. buildFfmpegArgs(deviceIndex=1, outPath='/tmp/w.wav') returns exact expected array:
//    ['-f','avfoundation','-i','none:1','-ar','16000','-ac','1','-acodec','pcm_s16le','-y','/tmp/w.wav']
// 2. getTempPath() matches /whisper-[a-f0-9\-]+\.wav$/ and is inside os.tmpdir()
// 3. On mock ffmpeg exit code 1: stop() rejects with Error; cleanup (unlink) is called
// 4. 60-second guard: if mock ffmpeg runs > 60s, stop() is called automatically
// Export buildFfmpegArgs and getTempPath as named exports for testability
```

Implementation (`src/recorder.ts`):
```typescript
export class AudioRecorder {
  start(deviceIndex: number): void      // spawns ffmpeg, stores ChildProcess
  stop(): Promise<string>               // SIGTERM ffmpeg, resolves with WAV path
}
export function buildFfmpegArgs(deviceIndex: number, outPath: string): string[]
export function getTempPath(): string
```
- ffmpeg binary: `/opt/homebrew/bin/ffmpeg` (absolute path — Electron subprocesses do not inherit shell PATH)
- Audio format: `-f avfoundation -i none:<deviceIndex> -ar 16000 -ac 1 -acodec pcm_s16le -y <outPath>`
- `stop()` sends SIGTERM; ffmpeg finalizes WAV header before exiting (expected behavior)
- 60-second max guard via `setTimeout` that calls `stop()` automatically
- Cleanup on error: `fs.unlink(wavPath)` in rejection path

### Lane 2-C: `src/transcriber.ts` + `test/transcriber.test.ts` (TDD)
**Write `test/transcriber.test.ts` FIRST.**

Test contract (`test/transcriber.test.ts`):
```typescript
// 1. Mock python3 stdout '{"text":"hello world"}', exit 0 → transcribe() resolves "hello world"
// 2. Mock python3 stdout '{"error":"mlx not found"}', exit 1 → throws TranscriptionError
// 3. WAV unlink is called in BOTH the success path and the error path (finally block)
// 4. If python3 runs > 30s, process is killed and TranscriptionError is thrown
// Mock: child_process.spawn, fs.unlink
```

Implementation (`src/transcriber.ts`):
```typescript
export class Transcriber {
  constructor(private pythonPath: string, private scriptPath: string) {}
  async transcribe(wavPath: string, model: ModelId, language: string): Promise<string>
}
```
- Spawn: `pythonPath scripts/transcribe.py --audio <wav> --model <model> --language <lang>`
- Pipe stderr to `logger.debug`
- 30-second timeout: kill process, throw `TranscriptionError('Transcription timed out', -1)`
- `finally`: `fs.unlink(wavPath)` — **unconditionally** — whether success or error
- Parse stdout JSON: `result.text` on success; throw `TranscriptionError(result.error, exitCode)` on failure

### Wave 2 Completion Gate
```bash
npx tsc --noEmit
npm run build
node --test 'dist/test/startup.test.js'
node --test 'dist/test/recorder.test.js'
node --test 'dist/test/transcriber.test.js'
```

---

## Wave 3 — UI Layer
**Prerequisite:** Wave 2 complete.  
**Parallelizable within wave:** YES — `hotkey.ts` and `tray.ts` have no intra-wave imports.  
**Sub-agent count:** Up to 2 parallel agents.  
**No dedicated test files** for Wave 3 (UI modules are tested via integration in Wave 5 manual verification).

### Lane 3-A: `src/hotkey.ts`
```typescript
export class HotkeyManager {
  register(accelerator: string, callback: () => void): boolean
  unregister(): void
}
```
- Thin wrapper around `electron.globalShortcut`
- `register()` returns `false` and logs a warning if registration fails (accelerator already in use)
- Must be called inside `app.whenReady()` — enforced by consumer (`main.ts`), not here
- On app quit: `globalShortcut.unregisterAll()`

### Lane 3-B: `src/tray.ts`
```typescript
export class TrayManager extends EventEmitter {
  setState(state: AppState): void
  buildContextMenu(config: Config): void
  destroy(): void
}
// Emits: 'toggle', 'quit', 'modelChange', 'outputModeChange'
```
- State machine: `idle → recording → processing → idle`; `* → error → idle (after 3 seconds)`
- Icon paths: `assets/icon-{idle,recording,processing,error}.png`
- Animation during `processing`: `setInterval` cycling `icon-processing.png` frames at 150ms
- Context menu items:
  1. Model picker (radio group of `ModelId` values)
  2. Output mode toggle (`clipboard` / `autotype` / `both`)
  3. Separator
  4. Quit
- During development: use `nativeImage.createFromDataURL` with a base64 emoji PNG as placeholder to unblock UI work if assets aren't ready

### Wave 3 Completion Gate
```bash
npx tsc --noEmit    # hotkey.ts + tray.ts must type-check
```

---

## Wave 4 — Entry Point + Assets
**Prerequisite:** Waves 0–3 complete.  
**Sequential within wave:** `src/main.ts` depends on all prior modules being done; assets are independent but must exist.  
**Sub-agent count:** 1 agent (main.ts) + assets can be created in parallel.

### `assets/icon-idle.png`, `icon-recording.png`, `icon-processing.png`, `icon-error.png`
- 22×22 px template images (black on transparent, macOS tray convention)
- For development: create placeholder 22×22 px PNGs using any method (even `sips` or ImageMagick)
- For production: proper SF Symbols-style microphone icons

### `src/main.ts`
```typescript
// Top-level state machine
let appState: AppState = 'idle';

app.whenReady().then(async () => {
  app.dock.hide();
  if (!app.requestSingleInstanceLock()) { app.quit(); return; }

  let startupResult: StartupResult;
  try {
    startupResult = await runStartupChecks();
  } catch (err) {
    new Notification({ title: 'Whisper App — Setup Error', body: (err as SetupError).userMessage }).show();
    app.quit();
    return;
  }

  const config = new Config();
  const tray = new TrayManager();
  const recorder = new AudioRecorder();
  const transcriber = new Transcriber(startupResult.pythonPath, path.join(__dirname, '../scripts/transcribe.py'));
  const hotkey = new HotkeyManager();

  tray.buildContextMenu(config);
  tray.setState('idle');

  const onToggle = async () => {
    if (appState === 'idle') {
      appState = 'recording';
      tray.setState('recording');
      recorder.start(startupResult.deviceIndex);
    } else if (appState === 'recording') {
      appState = 'processing';
      tray.setState('processing');
      try {
        const wavPath = await recorder.stop();
        const text = await transcriber.transcribe(wavPath, config.getModel(), config.getLanguage());
        await deliver(text, config.getOutputMode());
        appState = 'idle';
        tray.setState('idle');
      } catch (err) {
        appState = 'error';
        tray.setState('error');
        new Notification({ title: 'Transcription failed', body: (err as Error).message }).show();
        setTimeout(() => { appState = 'idle'; tray.setState('idle'); }, 3000);
      }
    }
  };

  hotkey.register(config.getHotkey(), onToggle);
  tray.on('toggle', onToggle);
  tray.on('quit', () => app.quit());
  tray.on('modelChange', (model: ModelId) => { config.setModel(model); tray.buildContextMenu(config); });
  tray.on('outputModeChange', (mode: OutputMode) => { config.setOutputMode(mode); tray.buildContextMenu(config); });

  app.on('will-quit', () => hotkey.unregister());
});
```

### Wave 4 Completion Gate
```bash
npx tsc --noEmit    # main.ts + all imports must type-check with zero errors
npm run build       # dist/main.js must be produced by esbuild
```

---

## Wave 5 — Full Test Suite + Verification
**Prerequisite:** Wave 4 complete; `dist/main.js` exists; `dist/test/**/*.test.js` compiled.  
**Sequential:** Run verification commands in order; each step gates the next.  
**Sub-agent count:** 1 verification agent.

### Step 1 — Static Type Check
```bash
npx tsc --noEmit
# PASS criterion: exit code 0, zero diagnostic messages
```

### Step 2 — Build
```bash
npm run build
# PASS criterion: dist/main.js exists, esbuild exit code 0, no bundle errors
```

### Step 3 — Unit Tests (Node built-in runner)
```bash
node --test 'dist/test/config.test.js'
node --test 'dist/test/output.test.js'
node --test 'dist/test/startup.test.js'
node --test 'dist/test/recorder.test.js'
node --test 'dist/test/transcriber.test.js'
# PASS criterion: all subtests pass, 0 failures reported
```

### Step 4 — Create Test Fixtures
If not already created during Wave 2:
```bash
# ffmpeg-device-list.txt — capture from this machine:
/opt/homebrew/bin/ffmpeg -f avfoundation -list_devices true -i "" 2>&1 | \
  grep -A 20 "AVFoundation" > test/fixtures/ffmpeg-device-list.txt

# hello.wav — 1-second 16kHz mono WAV (silence or spoken word):
/opt/homebrew/bin/ffmpeg -f lavfi -i "sine=frequency=440:duration=1" \
  -ar 16000 -ac 1 -acodec pcm_s16le test/fixtures/hello.wav
```

### Step 5 — Python Smoke Test
```bash
bash test/transcribe.py.test.sh
# PASS criterion: exit code 0, "PASS: transcribe.py smoke test" printed
# NOTE: requires mlx_whisper installed and hello.wav fixture present
```

### Step 6 — Launch Verification (manual)
```bash
npm start
# Verify checklist (manual):
# [ ] No Dock icon appears
# [ ] Tray icon visible in menu bar
# [ ] ⌥Space starts recording (icon changes to recording state)
# [ ] Second ⌥Space triggers transcription (icon changes to processing state)
# [ ] Text appears on clipboard within 5 seconds
# [ ] Tray context menu shows model picker and output mode toggle
# [ ] Quit from context menu exits cleanly
```

### Step 7 — Memory Check
```bash
# After npm start, before any transcription:
ps aux | grep -i electron | grep -v grep | awk '{print $6}'
# PASS criterion: RSS ≤ 204800 KB (200 MB)
```

---

## Sub-Agent Dispatch Summary

| Wave | Agents | Files | Parallelizable | Gate-in | Gate-out |
|---|---|---|---|---|---|
| **0** | 1 | `package.json`, `tsconfig.json`, `esbuild.config.mjs`, `.gitignore`, `src/types.ts` | Writes parallel; `npm install` sequential after | Nothing | `npm install` success + `tsc --noEmit` on types.ts |
| **1-A** | 1 | `src/logger.ts` | ✅ with 1-B, 1-C, 1-D | Wave 0 done | tsc pass |
| **1-B** | 1 | `src/config.ts` + `test/config.test.ts` | ✅ with 1-A, 1-C, 1-D | Wave 0 done | tsc pass + config test pass |
| **1-C** | 1 | `src/output.ts` + `test/output.test.ts` | ✅ with 1-A, 1-B, 1-D | Wave 0 done | tsc pass + output test pass |
| **1-D** | 1 | `scripts/transcribe.py` + `test/transcribe.py.test.sh` | ✅ with 1-A, 1-B, 1-C | Wave 0 done | smoke test deferred to Wave 5 |
| **2-A** | 1 | `src/startup.ts` + `test/startup.test.ts` + fixtures | ✅ with 2-B, 2-C | Wave 1 done | tsc pass + startup test pass |
| **2-B** | 1 | `src/recorder.ts` + `test/recorder.test.ts` | ✅ with 2-A, 2-C | Wave 1 done | tsc pass + recorder test pass |
| **2-C** | 1 | `src/transcriber.ts` + `test/transcriber.test.ts` | ✅ with 2-A, 2-B | Wave 1 done | tsc pass + transcriber test pass |
| **3-A** | 1 | `src/hotkey.ts` | ✅ with 3-B | Wave 2 done | tsc pass |
| **3-B** | 1 | `src/tray.ts` | ✅ with 3-A | Wave 2 done | tsc pass |
| **4** | 1 | `src/main.ts` + `assets/icon-*.png` (4 files) | Assets parallel to main.ts | Wave 3 done | tsc --noEmit + npm run build |
| **5** | 1 | Verification only | Sequential steps | Wave 4 done | All tests + checks pass |

---

## TDD Embedding Summary

Tests are written **before or concurrent with** their source file in the same sub-agent lane. The test defines the module's contract; the implementation makes it pass.

| Test File | Written In | Tests Source File | TDD Order |
|---|---|---|---|
| `test/config.test.ts` | Wave 1-B | `src/config.ts` | Test first |
| `test/output.test.ts` | Wave 1-C | `src/output.ts` | Test first |
| `test/transcribe.py.test.sh` | Wave 1-D | `scripts/transcribe.py` | Test first |
| `test/startup.test.ts` | Wave 2-A | `src/startup.ts` | Test first |
| `test/fixtures/ffmpeg-device-list.txt` | Wave 2-A | `src/startup.ts` | Fixture before tests |
| `test/fixtures/hello.wav` | Wave 2 (any lane) | `scripts/transcribe.py` | Fixture before Wave 5 |
| `test/recorder.test.ts` | Wave 2-B | `src/recorder.ts` | Test first |
| `test/transcriber.test.ts` | Wave 2-C | `src/transcriber.ts` | Test first |

**No test files for:** `logger.ts` (I/O side effects; tested implicitly), `hotkey.ts` (thin Electron wrapper; requires live app loop), `tray.ts` (UI; requires live Electron renderer), `main.ts` (integration entry point; tested via manual Wave 5 launch).

---

## Risk Register (unchanged from PLAN.md, retained for agent reference)

| Risk | Severity | Mitigation |
|---|---|---|
| Electron 36 + macOS 26 Tahoe | Medium | Fallback: `electron@37.10.3` |
| Python path in Electron subprocess | Medium | `startup.ts` resolves via `which python3`; store absolute path |
| `electron-store@11` ESM/CJS | Low | `esbuild --format=cjs` handles boundary |
| AppleScript special characters | Low | `execFile('osascript', ['-e', script])` — no shell interpolation |
| Mic permission timing | Medium | `await askForMediaAccess()` in startup; guard in `recorder.start()` |
| ffmpeg `none:<index>` format | Low | Confirmed working; use absolute path `/opt/homebrew/bin/ffmpeg` |

---

## Final Verification Sequence (Wave 5 Agent Script)

```bash
# Run all steps in order. Each must pass before proceeding.

npm install                                    # Step 0 (if not done in Wave 0)
npx tsc --noEmit                               # Step 1 — zero TS errors
npm run build                                  # Step 2 — dist/main.js produced
node --test 'dist/test/config.test.js'         # Step 3a
node --test 'dist/test/output.test.js'         # Step 3b
node --test 'dist/test/startup.test.js'        # Step 3c
node --test 'dist/test/recorder.test.js'       # Step 3d
node --test 'dist/test/transcriber.test.js'    # Step 3e
bash test/transcribe.py.test.sh                # Step 4 — Python smoke test
npm start                                      # Step 5 — manual launch verification
ps aux | grep -i electron | grep -v grep | awk '{print $6}'  # Step 6 — memory check ≤ 204800 KB
```

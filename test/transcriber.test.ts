/**
 * TDD tests for src/transcriber.ts
 * Mocks child_process.spawn and fs.unlink to verify behavior.
 * Uses Node.js built-in test runner + assert
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

// ─── Track mock calls ─────────────────────────────────────────────────────────
let unlinkCalled = false;
let unlinkPath = '';

// ─── Mock fs module ───────────────────────────────────────────────────────────
const fsMod = require('node:fs');
const originalUnlink = fsMod.unlink;
fsMod.unlink = (filePath: string, cb: (err: Error | null) => void) => {
  unlinkCalled = true;
  unlinkPath = filePath;
  cb(null);
};

// ─── Mock child_process.spawn ─────────────────────────────────────────────────
interface MockProcess extends EventEmitter {
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: (signal?: string) => void;
  killed: boolean;
}

type SpawnScenario = 'success' | 'error' | 'timeout';
let spawnScenario: SpawnScenario = 'success';
let spawnStdout = '{"text":"hello world"}';
let spawnExitCode = 0;

function createMockProcess(): MockProcess {
  const proc = new EventEmitter() as MockProcess;
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.killed = false;
  proc.kill = (_signal?: string) => {
    proc.killed = true;
    // Simulate process killed
    setImmediate(() => proc.emit('close', null, 'SIGTERM'));
  };

  setImmediate(() => {
    if (spawnScenario === 'timeout') {
      // Don't emit anything — let the timeout fire
      return;
    }
    proc.stdout.emit('data', Buffer.from(spawnStdout));
    proc.emit('close', spawnExitCode);
  });

  return proc;
}

let lastSpawnArgs: string[] = [];

const cpMod = require('node:child_process');
cpMod.spawn = (
  _cmd: string,
  args: string[],
  _opts?: object,
) => {
  lastSpawnArgs = args;
  return createMockProcess();
};

// ─── Now import Transcriber (after mocks are in place) ────────────────────────
const { Transcriber } = require('../src/transcriber');
const { TranscriptionError } = require('../src/types');

describe('Transcriber', () => {
  beforeEach(() => {
    unlinkCalled = false;
    unlinkPath = '';
    spawnScenario = 'success';
    spawnStdout = '{"text":"hello world"}';
    spawnExitCode = 0;
    lastSpawnArgs = [];
  });

  test('success path: resolves with transcribed text', async () => {
    const t = new Transcriber('/usr/bin/python3', 'scripts/transcribe.py');
    const result = await t.transcribe('/tmp/test.wav', 'mlx-community/whisper-turbo', 'en');
    assert.equal(result, 'hello world');
  });

  test('success path: unlink is called (finally block)', async () => {
    const t = new Transcriber('/usr/bin/python3', 'scripts/transcribe.py');
    await t.transcribe('/tmp/test.wav', 'mlx-community/whisper-turbo', 'en');
    assert.ok(unlinkCalled, 'unlink should be called in success path');
    assert.equal(unlinkPath, '/tmp/test.wav');
  });

  test('error path: non-zero exit throws TranscriptionError', async () => {
    spawnStdout = '{"error":"mlx not found"}';
    spawnExitCode = 1;

    const t = new Transcriber('/usr/bin/python3', 'scripts/transcribe.py');
    await assert.rejects(
      async () => t.transcribe('/tmp/test.wav', 'mlx-community/whisper-turbo', 'en'),
      (err: unknown) => {
        assert.ok(err instanceof TranscriptionError, 'should throw TranscriptionError');
        assert.ok((err as Error).message.includes('mlx not found'));
        return true;
      },
    );
  });

  test('error path: unlink is called even on failure (finally block)', async () => {
    spawnStdout = '{"error":"something went wrong"}';
    spawnExitCode = 1;

    const t = new Transcriber('/usr/bin/python3', 'scripts/transcribe.py');
    try {
      await t.transcribe('/tmp/test.wav', 'mlx-community/whisper-turbo', 'en');
    } catch {
      // expected
    }
    assert.ok(unlinkCalled, 'unlink should be called even on error path');
    assert.equal(unlinkPath, '/tmp/test.wav');
  });

  test('no initialPrompt arg: --initial-prompt flag is omitted entirely', async () => {
    const t = new Transcriber('/usr/bin/python3', 'scripts/transcribe.py');
    await t.transcribe('/tmp/test.wav', 'mlx-community/whisper-turbo', 'en');
    assert.ok(
      !lastSpawnArgs.includes('--initial-prompt'),
      'flag should be omitted when initialPrompt is not provided',
    );
  });

  test('empty-string initialPrompt: --initial-prompt flag is omitted entirely', async () => {
    const t = new Transcriber('/usr/bin/python3', 'scripts/transcribe.py');
    await t.transcribe('/tmp/test.wav', 'mlx-community/whisper-turbo', 'en', '   ');
    assert.ok(
      !lastSpawnArgs.includes('--initial-prompt'),
      'flag should be omitted when initialPrompt is whitespace-only',
    );
  });

  test('non-empty initialPrompt: --initial-prompt flag and value are passed to spawn', async () => {
    const t = new Transcriber('/usr/bin/python3', 'scripts/transcribe.py');
    await t.transcribe(
      '/tmp/test.wav',
      'mlx-community/whisper-turbo',
      'en',
      'mlx-whisper, uiohook-napi',
    );
    const idx = lastSpawnArgs.indexOf('--initial-prompt');
    assert.notEqual(idx, -1, '--initial-prompt flag should be present');
    assert.equal(lastSpawnArgs[idx + 1], 'mlx-whisper, uiohook-napi');
  });
});

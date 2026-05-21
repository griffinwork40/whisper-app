/**
 * TDD tests for src/recorder.ts
 * Tests exported utility functions buildFfmpegArgs and getTempPath.
 * Uses Node.js built-in test runner + assert
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as os from 'node:os';

const { buildFfmpegArgs, getTempPath } = require('../src/recorder');

describe('recorder — buildFfmpegArgs', () => {
  test('produces correct arg array for device index 1', () => {
    const args = buildFfmpegArgs(1, '/tmp/w.wav');
    assert.deepEqual(args, [
      '-f', 'avfoundation',
      '-i', 'none:1',
      '-ar', '16000',
      '-ac', '1',
      '-acodec', 'pcm_s16le',
      '-y',
      '/tmp/w.wav',
    ]);
  });

  test('produces correct arg array for device index 0', () => {
    const args = buildFfmpegArgs(0, '/tmp/test.wav');
    assert.equal(args[3], 'none:0');
    assert.equal(args[args.length - 1], '/tmp/test.wav');
  });

  test('device index 3 produces none:3', () => {
    const args = buildFfmpegArgs(3, '/some/path.wav');
    assert.equal(args[3], 'none:3');
  });

  test('output path is the last argument', () => {
    const outPath = '/custom/output/recording.wav';
    const args = buildFfmpegArgs(0, outPath);
    assert.equal(args[args.length - 1], outPath);
  });
});

describe('recorder — getTempPath', () => {
  test('returns a path inside os.tmpdir()', () => {
    const p = getTempPath();
    assert.ok(
      p.startsWith(os.tmpdir()),
      `Expected path to start with ${os.tmpdir()}, got: ${p}`,
    );
  });

  test('filename matches /whisper-[a-f0-9-]+\\.wav$/', () => {
    const p = getTempPath();
    const basename = p.split('/').pop()!;
    assert.match(basename, /^whisper-[a-f0-9-]+\.wav$/);
  });

  test('two calls return different paths (unique per call)', () => {
    const p1 = getTempPath();
    const p2 = getTempPath();
    assert.notEqual(p1, p2);
  });
});

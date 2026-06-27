/**
 * TDD tests for src/sound.ts
 * Uses Node.js built-in test runner + assert
 * Mocks node:child_process.spawn before importing src/sound
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ─── Mock child_process.spawn ─────────────────────────────────────────────────

interface SpawnCall {
  command: string;
  args: string[];
}

let spawnCalls: SpawnCall[] = [];
let spawnShouldError = false;

// Minimal ChildProcess-like stub — callers attach .on('error') and .on('close')
function makeMockChild() {
  return {
    on(_event: string, _listener: (...args: unknown[]) => void) {
      // If the caller attaches an 'error' listener and we're simulating an error,
      // schedule the emission asynchronously to mimic EventEmitter behavior.
      if (_event === 'error' && spawnShouldError) {
        setImmediate(() => _listener(new Error('mock afplay error')));
      }
      return this;
    },
  };
}

// Patch spawn on the already-loaded child_process module in require.cache
const cpModule = require('node:child_process');
const originalSpawn = cpModule.spawn;
cpModule.spawn = (command: string, args: string[]) => {
  spawnCalls.push({ command, args });
  if (spawnShouldError) {
    throw new Error('mock spawn failure');
  }
  return makeMockChild();
};

// Import sound module AFTER the mock is in place
const { playStartSound, playStopSound } = require('../src/sound');

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('sound', () => {
  beforeEach(() => {
    spawnCalls = [];
    spawnShouldError = false;
  });

  test('playStartSound calls spawn with afplay binary', () => {
    playStartSound();
    assert.ok(spawnCalls.length > 0, 'spawn should have been called');
    assert.equal(spawnCalls[0].command, '/usr/bin/afplay');
  });

  test('playStartSound targets start.aiff', () => {
    playStartSound();
    assert.ok(spawnCalls.length > 0, 'spawn should have been called');
    assert.ok(
      spawnCalls[0].args[0].endsWith('start.aiff'),
      `expected args[0] to end with 'start.aiff', got: ${spawnCalls[0].args[0]}`,
    );
  });

  test('playStopSound calls spawn with afplay binary', () => {
    playStopSound();
    assert.ok(spawnCalls.length > 0, 'spawn should have been called');
    assert.equal(spawnCalls[0].command, '/usr/bin/afplay');
  });

  test('playStopSound targets stop.aiff', () => {
    playStopSound();
    assert.ok(spawnCalls.length > 0, 'spawn should have been called');
    assert.ok(
      spawnCalls[0].args[0].endsWith('stop.aiff'),
      `expected args[0] to end with 'stop.aiff', got: ${spawnCalls[0].args[0]}`,
    );
  });

  test('spawn error does not throw from playStartSound', () => {
    spawnShouldError = true;
    assert.doesNotThrow(() => playStartSound(), 'playStartSound must not throw on spawn error');
  });

  test('spawn error does not throw from playStopSound', () => {
    spawnShouldError = true;
    assert.doesNotThrow(() => playStopSound(), 'playStopSound must not throw on spawn error');
  });

  test('each call to playStartSound spawns exactly once', () => {
    playStartSound();
    assert.equal(spawnCalls.length, 1);
  });
});

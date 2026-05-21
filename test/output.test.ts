/**
 * TDD tests for src/output.ts
 * Uses Node.js built-in test runner + assert
 * Mocks electron.clipboard, child_process.execFile, systemPreferences
 */

import { test, describe, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ─── Mock electron ────────────────────────────────────────────────────────────
let lastClipboardWrite: string | null = null;
let isTrustedResult = true;

const mockClipboard = {
  writeText: (text: string) => {
    lastClipboardWrite = text;
  },
};

const mockSystemPreferences = {
  isTrustedAccessibilityClient: (_prompt: boolean) => isTrustedResult,
};

// Inject electron mock into require cache before importing output
require.cache[require.resolve('electron')] = {
  id: 'electron',
  filename: 'electron',
  loaded: true,
  parent: null as never,
  children: [],
  paths: [],
  exports: {
    clipboard: mockClipboard,
    systemPreferences: mockSystemPreferences,
  },
} as unknown as NodeJS.Module;

// ─── Mock child_process.execFile ──────────────────────────────────────────────
let lastExecFileArgs: { file: string; args: string[] } | null = null;
let execFileShouldFail = false;

const originalExecFile = require('node:child_process').execFile;

// Patch child_process module in cache
const cpModule = require('node:child_process');
const originalExecFileRef = cpModule.execFile;
cpModule.execFile = (
  file: string,
  args: string[],
  callback: (err: Error | null) => void,
) => {
  lastExecFileArgs = { file, args };
  if (execFileShouldFail) {
    callback(new Error('osascript failed'));
  } else {
    callback(null);
  }
};

// Now import output (after mocks are in place)
const {
  writeToClipboard,
  autotype,
  deliver,
} = require('../src/output');

describe('output', () => {
  beforeEach(() => {
    lastClipboardWrite = null;
    lastExecFileArgs = null;
    execFileShouldFail = false;
    isTrustedResult = true;
  });

  test('writeToClipboard calls clipboard.writeText with correct string', () => {
    writeToClipboard('hello world');
    assert.equal(lastClipboardWrite, 'hello world');
  });

  test('autotype builds osascript -e with keystroke script when trusted', async () => {
    await autotype('hello');
    assert.ok(lastExecFileArgs !== null, 'execFile should have been called');
    assert.equal(lastExecFileArgs!.file, 'osascript');
    assert.ok(
      Array.isArray(lastExecFileArgs!.args) &&
        lastExecFileArgs!.args[0] === '-e',
      'first arg should be -e',
    );
    assert.ok(
      lastExecFileArgs!.args[1].includes('keystroke'),
      'script should include keystroke',
    );
    assert.ok(
      lastExecFileArgs!.args[1].includes('System Events'),
      'script should include System Events',
    );
  });

  test('deliver clipboard calls only writeToClipboard, not execFile', async () => {
    await deliver('test text', 'clipboard');
    assert.equal(lastClipboardWrite, 'test text');
    assert.equal(lastExecFileArgs, null, 'execFile should NOT be called for clipboard mode');
  });

  test('deliver both calls writeToClipboard AND autotype', async () => {
    await deliver('both text', 'both');
    assert.equal(lastClipboardWrite, 'both text');
    assert.ok(lastExecFileArgs !== null, 'execFile should be called for both mode');
  });

  test('autotype is skipped when isTrustedAccessibilityClient returns false; clipboard still written', async () => {
    isTrustedResult = false;
    await deliver('fallback text', 'autotype');
    // Clipboard should still be written as fallback
    assert.equal(lastClipboardWrite, 'fallback text');
    // osascript should NOT be called
    assert.equal(lastExecFileArgs, null, 'execFile should NOT be called when not trusted');
  });

  test('deliver autotype calls execFile when trusted', async () => {
    isTrustedResult = true;
    await deliver('auto text', 'autotype');
    assert.ok(lastExecFileArgs !== null, 'execFile should be called when trusted');
  });
});

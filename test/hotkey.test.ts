/**
 * TDD tests for parseAccelerator in src/hotkey.ts
 * Uses Node.js built-in test runner + assert
 *
 * parseAccelerator is a pure function — no Electron dependency needed.
 * We extract it via a targeted require after mocking the electron module.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// Mock electron before any require of src/hotkey reaches it
const Module = require('module');
const _origLoad = Module._load.bind(Module);
Module._load = (id: string, ...rest: unknown[]) => {
  if (id === 'electron') {
    return { globalShortcut: { register: () => true, unregister: () => {}, unregisterAll: () => {} } };
  }
  return _origLoad(id, ...rest);
};

const { parseAccelerator } = require('../src/hotkey');

// Helper: assert a Set contains a value
function hasModifier(set: Set<string>, mod: string): boolean {
  return set.has(mod);
}

describe('parseAccelerator', () => {
  test('Option+Cmd → modifiers alt+cmd, key null', () => {
    const { modifiers, key } = parseAccelerator('Option+Cmd');
    assert.ok(hasModifier(modifiers, 'alt'), 'expected alt');
    assert.ok(hasModifier(modifiers, 'cmd'), 'expected cmd');
    assert.equal(key, null);
  });

  test('Cmd+Option → same as Option+Cmd (order independent)', () => {
    const { modifiers, key } = parseAccelerator('Cmd+Option');
    assert.ok(hasModifier(modifiers, 'alt'));
    assert.ok(hasModifier(modifiers, 'cmd'));
    assert.equal(key, null);
  });

  test('Control+Alt+Shift+D → modifiers ctrl+alt+shift, key D', () => {
    const { modifiers, key } = parseAccelerator('Control+Alt+Shift+D');
    assert.ok(hasModifier(modifiers, 'ctrl'));
    assert.ok(hasModifier(modifiers, 'alt'));
    assert.ok(hasModifier(modifiers, 'shift'));
    assert.equal(key, 'D');
  });

  test('CmdOrCtrl+Space → modifiers cmd (darwin alias), key Space', () => {
    // CmdOrCtrl maps to 'cmd' per MODIFIER_TOKEN_MAP
    const { modifiers, key } = parseAccelerator('CmdOrCtrl+Space');
    assert.ok(hasModifier(modifiers, 'cmd'), 'CmdOrCtrl should resolve to cmd');
    assert.ok(!hasModifier(modifiers, 'ctrl'), 'should not also add ctrl');
    assert.equal(key, 'Space');
  });

  test('Option+Space → modifiers alt, key Space', () => {
    const { modifiers, key } = parseAccelerator('Option+Space');
    assert.ok(hasModifier(modifiers, 'alt'));
    assert.equal(modifiers.size, 1);
    assert.equal(key, 'Space');
  });

  test('cmd+option (lowercase) → same as Cmd+Option', () => {
    const { modifiers, key } = parseAccelerator('cmd+option');
    assert.ok(hasModifier(modifiers, 'alt'));
    assert.ok(hasModifier(modifiers, 'cmd'));
    assert.equal(key, null);
  });

  test('A → no modifiers, key A', () => {
    const { modifiers, key } = parseAccelerator('A');
    assert.equal(modifiers.size, 0);
    assert.equal(key, 'A');
  });

  test('throws when given two non-modifier keys (A+B)', () => {
    assert.throws(
      () => parseAccelerator('A+B'),
      /non-modifier|invalid|two non-modifier/i,
    );
  });
});

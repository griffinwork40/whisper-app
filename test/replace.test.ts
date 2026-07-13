/**
 * TDD tests for src/replace.ts
 * Pure function — no mocking needed.
 * Uses Node.js built-in test runner + assert
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { applyReplacementRules } from '../src/replace';

describe('applyReplacementRules', () => {
  test('empty rules array is a no-op', () => {
    assert.equal(applyReplacementRules('hello world', []), 'hello world');
  });

  test('single rule replaces all occurrences', () => {
    const result = applyReplacementRules('afk afk afk', [{ from: 'afk', to: 'AFK' }]);
    assert.equal(result, 'AFK AFK AFK');
  });

  test('multiple rules apply in array order', () => {
    const result = applyReplacementRules('foo bar', [
      { from: 'foo', to: 'bar' },
      { from: 'bar', to: 'baz' },
    ]);
    // 'foo bar' -> 'bar bar' (rule 1) -> 'baz baz' (rule 2) — both instances
    // of 'bar' are replaced by rule 2, including the one rule 1 just produced.
    assert.equal(result, 'baz baz');
  });

  test('rule with empty "from" is ignored, not an infinite/no-op footgun', () => {
    const result = applyReplacementRules('hello', [{ from: '', to: 'X' }]);
    assert.equal(result, 'hello');
  });

  test('matching is literal, not regex', () => {
    const result = applyReplacementRules('a.b.c', [{ from: '.', to: '-' }]);
    assert.equal(result, 'a-b-c');
    // If this were regex, '.' would match every character, not just literal dots.
  });

  test('matching is case-sensitive', () => {
    const result = applyReplacementRules('Whisper whisper WHISPER', [
      { from: 'whisper', to: 'Whisper App' },
    ]);
    assert.equal(result, 'Whisper Whisper App WHISPER');
  });

  test('no matches leaves text unchanged', () => {
    const result = applyReplacementRules('hello world', [{ from: 'xyz', to: 'abc' }]);
    assert.equal(result, 'hello world');
  });
});

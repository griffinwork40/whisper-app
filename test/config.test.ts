/**
 * TDD tests for src/config.ts
 * Uses Node.js built-in test runner + assert
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';

// Mock electron before electron-store (pulled in transitively by src/config)
// can require it. In CI the electron binary is not installed, so a real
// require('electron') throws "Electron failed to install correctly" and every
// Config test fails with "Config is not a constructor". These unit tests never
// touch the GUI, so a minimal stub suffices. Mirrors test/hotkey.test.ts.
const Module = require('module');
const _origElectronLoad = Module._load.bind(Module);
Module._load = (id: string, ...rest: unknown[]) => {
  if (id === 'electron') {
    return {
      app: {
        getPath: () => os.tmpdir(),
        getName: () => 'whisper-app',
        getVersion: () => '0.0.0-test',
        getAppPath: () => process.cwd(),
      },
    };
  }
  return _origElectronLoad(id, ...rest);
};

// We'll use a temp dir so each test gets a clean config store
let tempDir: string;

// We need to load Config fresh per test to avoid cross-test contamination.
// Since electron-store uses app.getPath in production, we'll test the Config
// class with a custom cwd option injected via the test shim.

// Config class is tested via its exported interface.
// We import dynamically to allow per-test isolation where needed.

describe('Config', () => {
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'whisper-config-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('default model is whisper-turbo', () => {
    // Import inline to get fresh module state
    const { Config } = require('../src/config');
    const config = new Config({ cwd: tempDir });
    assert.equal(config.getModel(), 'mlx-community/whisper-turbo');
  });

  test('default outputMode is clipboard', () => {
    const { Config } = require('../src/config');
    const config = new Config({ cwd: tempDir });
    assert.equal(config.getOutputMode(), 'clipboard');
  });

  test('default hotkey is Option+Cmd (hold-to-talk)', () => {
    const { Config } = require('../src/config');
    const config = new Config({ cwd: tempDir });
    assert.equal(config.getHotkey(), 'Option+Cmd');
  });

  test('default language is en', () => {
    const { Config } = require('../src/config');
    const config = new Config({ cwd: tempDir });
    assert.equal(config.getLanguage(), 'en');
  });

  test('setModel / getModel round-trip', () => {
    const { Config } = require('../src/config');
    const config = new Config({ cwd: tempDir });
    config.setModel('mlx-community/whisper-tiny');
    assert.equal(config.getModel(), 'mlx-community/whisper-tiny');
  });

  test('setOutputMode / getOutputMode round-trip', () => {
    const { Config } = require('../src/config');
    const config = new Config({ cwd: tempDir });
    config.setOutputMode('autotype');
    assert.equal(config.getOutputMode(), 'autotype');
  });

  test('persistence: new Config instance sees updated value', () => {
    const { Config } = require('../src/config');
    const config1 = new Config({ cwd: tempDir });
    config1.setModel('mlx-community/whisper-large-v3-mlx');

    // New instance pointing to same directory
    const config2 = new Config({ cwd: tempDir });
    assert.equal(config2.getModel(), 'mlx-community/whisper-large-v3-mlx');
  });

  test('invalid model throws TypeError', () => {
    const { Config } = require('../src/config');
    const config = new Config({ cwd: tempDir });
    assert.throws(
      () => config.setModel('fake-model'),
      TypeError,
    );
  });

  test('invalid outputMode throws TypeError', () => {
    const { Config } = require('../src/config');
    const config = new Config({ cwd: tempDir });
    assert.throws(
      () => config.setOutputMode('invalid' as never),
      TypeError,
    );
  });
});

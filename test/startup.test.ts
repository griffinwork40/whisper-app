/**
 * TDD tests for src/startup.ts
 * Tests the exported parseDevices and selectDevice utility functions.
 * Uses Node.js built-in test runner + assert
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

// Import the pure functions directly — no Electron required
const { parseDevices, selectDevice } = require('../src/startup');

// __dirname resolves to dist/test when bundled; climb up to project root
const PROJECT_ROOT = path.join(__dirname, '..', '..');
const FIXTURE_PATH = path.join(
  PROJECT_ROOT,
  'test',
  'fixtures',
  'ffmpeg-device-list.txt',
);

describe('startup — parseDevices', () => {
  test('parses device list from fixture file correctly', () => {
    const fixtureText = fs.readFileSync(FIXTURE_PATH, 'utf8');
    const devices = parseDevices(fixtureText);

    assert.equal(devices.length, 3);
    assert.deepEqual(devices[0], { index: 0, name: 'Griffin 13 Pro Max Microphone' });
    assert.deepEqual(devices[1], { index: 1, name: 'Griffin\u2019s AirPods Pro' });
    assert.deepEqual(devices[2], { index: 2, name: 'MacBook Pro Microphone' });
  });

  test('returns empty array when no audio section present', () => {
    const noAudio = `AVFoundation video devices:\n[0] FaceTime HD Camera\n`;
    const devices = parseDevices(noAudio);
    assert.equal(devices.length, 0);
  });

  test('ignores video devices and only returns audio devices', () => {
    const fixtureText = fs.readFileSync(FIXTURE_PATH, 'utf8');
    const devices = parseDevices(fixtureText);
    // FaceTime HD Camera is a VIDEO device — must not appear
    const names = devices.map((d: { index: number; name: string }) => d.name);
    assert.ok(!names.includes('FaceTime HD Camera'), 'Video devices should not be included');
  });
});

describe('startup — selectDevice', () => {
  test('prefers device matching /MacBook Pro Microphone/', () => {
    const devices = [
      { index: 0, name: 'Griffin 13 Pro Max Microphone' },
      { index: 1, name: 'Griffin\u2019s AirPods Pro' },
      { index: 2, name: 'MacBook Pro Microphone' },
    ];
    const selected = selectDevice(devices);
    assert.equal(selected.index, 2);
    assert.equal(selected.name, 'MacBook Pro Microphone');
  });

  test('falls back to index 0 when no preferred device found', () => {
    const devices = [
      { index: 0, name: 'Other Mic' },
      { index: 1, name: 'USB Audio Device' },
    ];
    const selected = selectDevice(devices);
    assert.equal(selected.index, 0);
    assert.equal(selected.name, 'Other Mic');
  });

  test('falls back to index 0 when only one device present', () => {
    const devices = [{ index: 0, name: 'Generic Microphone' }];
    const selected = selectDevice(devices);
    assert.equal(selected.index, 0);
  });
});

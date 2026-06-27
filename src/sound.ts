/**
 * Sound module — plays audio cues at recording start and stop.
 * Uses afplay (macOS built-in) via spawn. Fire-and-forget: never throws,
 * never awaited. Errors are logged at warn level and the state machine
 * is unaffected.
 */

import { spawn } from 'node:child_process';
import * as path from 'node:path';
import * as logger from './logger';

const AFPLAY_PATH = '/usr/bin/afplay';

/**
 * Resolve a sound file path relative to the dist/sounds/ directory.
 * In production: dist/main.js → __dirname = dist/ → sounds/file
 */
function soundPath(file: string): string {
  return path.join(__dirname, 'sounds', file);
}

/**
 * Internal helper — spawns afplay with the given file path.
 * Fire-and-forget: attaches an error listener but never propagates.
 */
function playSound(filePath: string): void {
  try {
    const child = spawn(AFPLAY_PATH, [filePath]);
    child.on('error', (err: Error) => {
      logger.warn(`afplay error for ${filePath}:`, err.message);
    });
  } catch (err) {
    logger.warn(`Failed to spawn afplay for ${filePath}:`, (err as Error).message);
  }
}

/**
 * Play the recording-start audio cue (ascending two-tone chime).
 */
export function playStartSound(): void {
  playSound(soundPath('start.aiff'));
}

/**
 * Play the recording-stop audio cue (descending two-tone resolution).
 */
export function playStopSound(): void {
  playSound(soundPath('stop.aiff'));
}

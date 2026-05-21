/**
 * AudioRecorder — captures microphone audio via ffmpeg to a WAV file.
 * Uses absolute ffmpeg path (/opt/homebrew/bin/ffmpeg) since Electron
 * subprocesses do not inherit the shell PATH.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import * as logger from './logger';

const FFMPEG_PATH = '/opt/homebrew/bin/ffmpeg';
const MAX_RECORDING_MS = 60_000; // 60-second hard limit

/**
 * Build the ffmpeg argument array for recording from a specific AVFoundation device.
 */
export function buildFfmpegArgs(deviceIndex: number, outPath: string): string[] {
  return [
    '-f', 'avfoundation',
    '-i', `none:${deviceIndex}`,
    '-ar', '16000',
    '-ac', '1',
    '-acodec', 'pcm_s16le',
    '-y',
    outPath,
  ];
}

/**
 * Generate a unique temporary WAV file path inside os.tmpdir().
 */
export function getTempPath(): string {
  const uuid = randomUUID();
  return path.join(os.tmpdir(), `whisper-${uuid}.wav`);
}

export class AudioRecorder {
  private process: ChildProcess | null = null;
  private wavPath: string | null = null;
  private maxRecordingTimer: ReturnType<typeof setTimeout> | null = null;
  private stopResolver: ((path: string) => void) | null = null;
  private stopRejecter: ((err: Error) => void) | null = null;

  /**
   * Start recording from the specified AVFoundation device index.
   * Spawns an ffmpeg process that writes PCM16 mono 16kHz WAV audio.
   */
  start(deviceIndex: number): void {
    if (this.process) {
      logger.warn('AudioRecorder: already recording, ignoring start()');
      return;
    }

    this.wavPath = getTempPath();
    const args = buildFfmpegArgs(deviceIndex, this.wavPath);

    logger.debug(`Spawning ffmpeg: ${FFMPEG_PATH} ${args.join(' ')}`);
    this.process = spawn(FFMPEG_PATH, args, { stdio: ['ignore', 'ignore', 'pipe'] });

    this.process.stderr?.on('data', (data: Buffer) => {
      logger.debug('ffmpeg:', data.toString().trim());
    });

    this.process.on('error', (err: Error) => {
      logger.error('ffmpeg process error:', err.message);
      this.cleanup();
      if (this.stopRejecter) {
        this.stopRejecter(err);
        this.stopRejecter = null;
        this.stopResolver = null;
      }
    });

    this.process.on('close', (code: number | null) => {
      logger.debug(`ffmpeg exited with code ${code}`);
      if (this.maxRecordingTimer) {
        clearTimeout(this.maxRecordingTimer);
        this.maxRecordingTimer = null;
      }

      if (code !== null && code !== 0 && !this.stopResolver) {
        // Unexpected exit
        const err = new Error(`ffmpeg exited with code ${code}`);
        this.cleanup();
        if (this.stopRejecter) {
          this.stopRejecter(err);
          this.stopRejecter = null;
        }
        return;
      }

      if (this.stopResolver && this.wavPath) {
        const resolvedPath = this.wavPath;
        this.cleanup();
        this.stopResolver(resolvedPath);
        this.stopResolver = null;
        this.stopRejecter = null;
      }
    });

    // Auto-stop after max recording duration
    this.maxRecordingTimer = setTimeout(() => {
      logger.warn('AudioRecorder: max recording duration reached, stopping automatically');
      this.stop().catch(err => logger.error('Auto-stop error:', err));
    }, MAX_RECORDING_MS);
  }

  /**
   * Stop recording. Returns a Promise that resolves with the WAV file path.
   * ffmpeg finalizes the WAV header when it receives SIGTERM.
   */
  stop(): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!this.process || !this.wavPath) {
        reject(new Error('AudioRecorder: not currently recording'));
        return;
      }

      this.stopResolver = resolve;
      this.stopRejecter = reject;

      // SIGTERM causes ffmpeg to finalize the WAV header and exit cleanly
      this.process.kill('SIGTERM');
    });
  }

  /**
   * Clean up internal state (but NOT the WAV file — that's transcriber's job).
   */
  private cleanup(): void {
    this.process = null;
    this.wavPath = null;
    if (this.maxRecordingTimer) {
      clearTimeout(this.maxRecordingTimer);
      this.maxRecordingTimer = null;
    }
  }
}

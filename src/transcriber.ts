/**
 * Transcriber — runs the Python transcription script and returns the transcript.
 * Deletes the WAV file unconditionally (success or failure) via finally block.
 */

import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import { type ModelId, TranscriptionError } from './types';
import * as logger from './logger';

const TRANSCRIPTION_TIMEOUT_MS = 30_000; // 30 seconds

export class Transcriber {
  constructor(
    private readonly pythonPath: string,
    private readonly scriptPath: string,
  ) {}

  /**
   * Transcribe a WAV file using the Python helper script.
   * Deletes the WAV file after completion (success or failure).
   *
   * @param wavPath  - Path to the WAV file to transcribe
   * @param model    - HuggingFace model repo ID
   * @param language - Language code (ISO 639-1) or 'auto'
   * @returns Transcribed text string
   * @throws TranscriptionError on non-zero exit or timeout
   */
  async transcribe(
    wavPath: string,
    model: ModelId,
    language: string,
  ): Promise<string> {
    try {
      return await this.runScript(wavPath, model, language);
    } finally {
      // Unconditionally delete the WAV file
      await new Promise<void>(resolve => {
        fs.unlink(wavPath, err => {
          if (err) {
            logger.warn(`Failed to delete WAV file ${wavPath}:`, err.message);
          } else {
            logger.debug(`Deleted WAV file: ${wavPath}`);
          }
          resolve();
        });
      });
    }
  }

  private runScript(
    wavPath: string,
    model: ModelId,
    language: string,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const args = [
        this.scriptPath,
        '--audio', wavPath,
        '--model', model,
        '--language', language,
      ];

      logger.debug(`Spawning: ${this.pythonPath} ${args.join(' ')}`);

      const proc = spawn(this.pythonPath, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
      let settled = false;

      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
          timeoutHandle = null;
        }
        fn();
      };

      // 30-second timeout
      timeoutHandle = setTimeout(() => {
        logger.warn('Transcription timed out — killing python process');
        proc.kill('SIGKILL');
        settle(() =>
          reject(new TranscriptionError('Transcription timed out', -1)),
        );
      }, TRANSCRIPTION_TIMEOUT_MS);

      proc.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });

      proc.stderr?.on('data', (chunk: Buffer) => {
        logger.debug('transcribe.py stderr:', chunk.toString().trim());
      });

      proc.on('error', (err: Error) => {
        settle(() => reject(new TranscriptionError(`Failed to spawn python: ${err.message}`, -1)));
      });

      proc.on('close', (code: number | null) => {
        settle(() => {
          let parsed: { text?: string; error?: string } = {};
          try {
            parsed = JSON.parse(stdout.trim());
          } catch {
            reject(
              new TranscriptionError(
                `Failed to parse transcriber output: ${stdout.trim()}`,
                code ?? -1,
              ),
            );
            return;
          }

          if (code === 0 && parsed.text !== undefined) {
            resolve(parsed.text);
          } else {
            reject(
              new TranscriptionError(
                parsed.error ?? `Transcription failed (exit ${code})`,
                code ?? -1,
              ),
            );
          }
        });
      });
    });
  }
}

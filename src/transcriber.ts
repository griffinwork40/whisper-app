/**
 * Transcriber — runs the Python transcription script and returns the transcript.
 * Deletes the WAV file unconditionally (success or failure) via finally block.
 */

import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import { type ModelId, TranscriptionError } from './types';
import * as logger from './logger';

const TRANSCRIPTION_TIMEOUT_MS = 30_000; // 30 seconds

// Whisper's most common hallucinations on silent/near-silent input. These come
// from YouTube/podcast outros dominating the training set: when the model has
// no real signal to decode, the language prior emits one of these. Filter them
// so they never reach the user's clipboard. Comparison is lowercased and
// stripped of surrounding punctuation/whitespace.
const HALLUCINATION_PHRASES = new Set([
  '',
  'thank you',
  'thanks',
  'thanks for watching',
  'thank you for watching',
  'thanks for watching!',
  'you',
  'bye',
  '.',
  '...',
]);

function isHallucination(text: string): boolean {
  const normalized = text
    .toLowerCase()
    .replace(/[\s\u200b]+/g, ' ')
    .replace(/[.!?,]+$/g, '')
    .trim();
  return HALLUCINATION_PHRASES.has(normalized);
}

export class Transcriber {
  constructor(
    private readonly pythonPath: string,
    private readonly scriptPath: string,
  ) {}

  /**
   * Transcribe a WAV file using the Python helper script.
   * Deletes the WAV file after completion (success or failure).
   *
   * @param wavPath      - Path to the WAV file to transcribe
   * @param model        - HuggingFace model repo ID
   * @param language     - Language code (ISO 639-1) or 'auto'
   * @param initialPrompt - Optional text passed to Whisper as `initial_prompt`
   *   to bias decoding toward custom vocabulary/proper nouns. Omitted from the
   *   spawned command entirely when empty, so the Python default (None) applies.
   * @returns Transcribed text string
   * @throws TranscriptionError on non-zero exit or timeout
   */
  async transcribe(
    wavPath: string,
    model: ModelId,
    language: string,
    initialPrompt = '',
  ): Promise<string> {
    try {
      return await this.runScript(wavPath, model, language, initialPrompt);
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
    initialPrompt: string,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const args = [
        this.scriptPath,
        '--audio', wavPath,
        '--model', model,
        '--language', language,
      ];

      // Only pass the flag when non-empty: an explicit empty string would
      // still be "not None" on the Python side and encode a spurious prompt
      // token, so omitting it entirely lets transcribe.py's argparse default
      // (None) apply.
      if (initialPrompt.trim().length > 0) {
        args.push('--initial-prompt', initialPrompt);
      }

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
            if (isHallucination(parsed.text)) {
              logger.info(
                `Filtered hallucination from silent/near-silent audio: "${parsed.text}"`,
              );
              resolve('');
            } else {
              resolve(parsed.text);
            }
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

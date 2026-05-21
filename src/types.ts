/**
 * Shared TypeScript types and enums for whisper-app.
 * Every module imports from here — must be defined before any other src/ file.
 */

export type AppState = 'idle' | 'recording' | 'processing' | 'error';

export type OutputMode = 'clipboard' | 'autotype' | 'both';

export type ModelId =
  | 'mlx-community/whisper-tiny'
  | 'mlx-community/whisper-turbo'
  | 'mlx-community/whisper-large-v3-turbo'
  | 'mlx-community/whisper-large-v3-mlx';

export const VALID_MODELS: readonly ModelId[] = [
  'mlx-community/whisper-tiny',
  'mlx-community/whisper-turbo',
  'mlx-community/whisper-large-v3-turbo',
  'mlx-community/whisper-large-v3-mlx',
] as const;

export const VALID_OUTPUT_MODES: readonly OutputMode[] = [
  'clipboard',
  'autotype',
  'both',
] as const;

export class TranscriptionError extends Error {
  constructor(
    message: string,
    public readonly exitCode: number,
  ) {
    super(message);
    this.name = 'TranscriptionError';
  }
}

export class SetupError extends Error {
  constructor(
    message: string,
    public readonly userMessage: string,
  ) {
    super(message);
    this.name = 'SetupError';
  }
}

export interface StartupResult {
  pythonPath: string;
  deviceIndex: number;
  deviceName: string;
}

export interface DeviceInfo {
  index: number;
  name: string;
}

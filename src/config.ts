/**
 * Config — electron-store backed typed configuration.
 * Schema with defaults for all fields.
 * Typed getter/setters with validation.
 */

import Store from 'electron-store';
import {
  type HotkeyMode,
  type ModelId,
  type OutputMode,
  VALID_HOTKEY_MODES,
  VALID_MODELS,
  VALID_OUTPUT_MODES,
} from './types';

interface ConfigSchema {
  hotkey: string;
  hotkeyMode: HotkeyMode;
  model: ModelId;
  language: string;
  outputMode: OutputMode;
  pythonPath: string;
  tempDir: string;
}

const defaults: ConfigSchema = {
  hotkey: 'Option+Cmd',
  hotkeyMode: 'hold',
  model: 'mlx-community/whisper-turbo',
  language: 'en',
  outputMode: 'clipboard',
  pythonPath: 'python3',
  tempDir: '/tmp',
};

interface ConfigOptions {
  /** Override the store directory (used in tests) */
  cwd?: string;
}

export class Config {
  private store: Store<ConfigSchema>;

  constructor(options: ConfigOptions = {}) {
    this.store = new Store<ConfigSchema>({
      name: 'config',
      defaults,
      ...(options.cwd ? { cwd: options.cwd } : {}),
    });
  }

  getModel(): ModelId {
    return this.store.get('model');
  }

  setModel(model: string): void {
    if (!(VALID_MODELS as readonly string[]).includes(model)) {
      throw new TypeError(
        `Invalid model: "${model}". Must be one of: ${VALID_MODELS.join(', ')}`,
      );
    }
    this.store.set('model', model as ModelId);
  }

  getOutputMode(): OutputMode {
    return this.store.get('outputMode');
  }

  setOutputMode(mode: string): void {
    if (!(VALID_OUTPUT_MODES as readonly string[]).includes(mode)) {
      throw new TypeError(
        `Invalid outputMode: "${mode}". Must be one of: ${VALID_OUTPUT_MODES.join(', ')}`,
      );
    }
    this.store.set('outputMode', mode as OutputMode);
  }

  getHotkey(): string {
    return this.store.get('hotkey');
  }

  setHotkey(hotkey: string): void {
    this.store.set('hotkey', hotkey);
  }

  getHotkeyMode(): HotkeyMode {
    return this.store.get('hotkeyMode');
  }

  setHotkeyMode(mode: string): void {
    if (!(VALID_HOTKEY_MODES as readonly string[]).includes(mode)) {
      throw new TypeError(
        `Invalid hotkeyMode: "${mode}". Must be one of: ${VALID_HOTKEY_MODES.join(', ')}`,
      );
    }
    this.store.set('hotkeyMode', mode as HotkeyMode);
  }

  getLanguage(): string {
    return this.store.get('language');
  }

  setLanguage(language: string): void {
    this.store.set('language', language);
  }

  getPythonPath(): string {
    return this.store.get('pythonPath');
  }

  setPythonPath(pythonPath: string): void {
    this.store.set('pythonPath', pythonPath);
  }
}

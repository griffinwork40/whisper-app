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
  type ReplacementRule,
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
  /** Passed to Whisper as `initial_prompt` — biases transcription toward
   *  custom vocabulary, proper nouns, or a punctuation/style hint. Whisper
   *  truncates this to roughly its last ~220 tokens, so keep it short. */
  customVocabulary: string;
  /** Literal find/replace pairs applied to the transcript before delivery,
   *  in array order. Complements customVocabulary: that *nudges* the model,
   *  this *guarantees* an exact substitution. */
  replacementRules: ReplacementRule[];
}

const defaults: ConfigSchema = {
  hotkey: 'Option+Cmd',
  hotkeyMode: 'hold',
  model: 'mlx-community/whisper-turbo',
  language: 'en',
  outputMode: 'clipboard',
  pythonPath: 'python3',
  tempDir: '/tmp',
  customVocabulary: '',
  replacementRules: [],
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

  getCustomVocabulary(): string {
    return this.store.get('customVocabulary');
  }

  setCustomVocabulary(text: string): void {
    this.store.set('customVocabulary', text);
  }

  getReplacementRules(): ReplacementRule[] {
    return this.store.get('replacementRules');
  }

  setReplacementRules(rules: ReplacementRule[]): void {
    if (!Array.isArray(rules)) {
      throw new TypeError('replacementRules must be an array of { from, to } pairs');
    }
    for (const rule of rules) {
      if (
        typeof rule !== 'object' ||
        rule === null ||
        typeof rule.from !== 'string' ||
        typeof rule.to !== 'string' ||
        rule.from.length === 0
      ) {
        throw new TypeError(
          `Invalid replacement rule: ${JSON.stringify(rule)}. Each rule needs a non-empty string "from" and a string "to".`,
        );
      }
    }
    this.store.set('replacementRules', rules);
  }
}

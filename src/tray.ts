/**
 * TrayManager — manages the macOS menu-bar tray icon and context menu.
 * Extends EventEmitter.
 * Emits: 'quit', 'modelChange', 'outputModeChange'
 *
 * Note: left-clicking the tray icon opens the context menu (Electron default
 * when a context menu is set). Recording is only triggered by the hotkey.
 */

import { Tray, Menu, nativeImage, app } from 'electron';
import { EventEmitter } from 'node:events';
import * as path from 'node:path';
import { type AppState, type ModelId, type OutputMode, VALID_MODELS } from './types';
import type { Config } from './config';
import * as logger from './logger';

const ANIMATION_INTERVAL_MS = 150;

// Resolve assets directory relative to the compiled main.js
// dist/main.js → project root/assets
const ASSETS_DIR = path.join(__dirname, '..', 'assets');

function iconPath(name: string): string {
  return path.join(ASSETS_DIR, `icon-${name}.png`);
}

/**
 * Format an Electron accelerator string into a macOS-style display string
 * (e.g. "Option+Cmd" → "⌥⌘", "Cmd+D" → "⌘D", "Alt+Space" → "⌥Space").
 */
export function formatAccelerator(accel: string): string {
  const SYMBOLS: Record<string, string> = {
    cmd: '⌘',
    command: '⌘',
    cmdorctrl: '⌘',
    commandorcontrol: '⌘',
    super: '⌘',
    meta: '⌘',
    alt: '⌥',
    option: '⌥',
    altgr: '⌥',
    ctrl: '⌃',
    control: '⌃',
    shift: '⇧',
  };
  return accel
    .split('+')
    .map((t) => t.trim())
    .map((t) => SYMBOLS[t.toLowerCase()] ?? t)
    .join('');
}

export class TrayManager extends EventEmitter {
  private tray: Tray | null = null;
  private state: AppState = 'idle';
  private animationTimer: ReturnType<typeof setInterval> | null = null;
  private errorResetTimer: ReturnType<typeof setTimeout> | null = null;
  private hotkeyDisplay: string = '';

  constructor() {
    super();
    this.init();
  }

  /**
   * Set the displayed hotkey used in tooltips. Pass the raw accelerator
   * string (e.g. "Option+Cmd"); it will be formatted to mac symbols.
   */
  setHotkeyDisplay(accelerator: string): void {
    this.hotkeyDisplay = formatAccelerator(accelerator);
    // Re-render tooltip for current state
    this.setState(this.state);
  }

  private init(): void {
    const icon = nativeImage.createFromPath(iconPath('idle'));
    this.tray = new Tray(icon);
    this.tray.setToolTip('Whisper App');

    // Intentionally no 'click' handler: recording is hotkey-only.
    // Left-click will open the context menu (Electron default behavior).

    logger.info('TrayManager initialized');
  }

  /**
   * Set the tray icon state and update the icon accordingly.
   */
  setState(state: AppState): void {
    this.state = state;

    // Clear any existing animation
    if (this.animationTimer) {
      clearInterval(this.animationTimer);
      this.animationTimer = null;
    }

    // Clear any existing error reset timer
    if (this.errorResetTimer) {
      clearTimeout(this.errorResetTimer);
      this.errorResetTimer = null;
    }

    if (!this.tray) return;

    const hk = this.hotkeyDisplay;

    switch (state) {
      case 'idle':
        this.tray.setImage(nativeImage.createFromPath(iconPath('idle')));
        this.tray.setToolTip(
          hk ? `Whisper App — Idle (${hk} to record)` : 'Whisper App — Idle',
        );
        break;

      case 'recording':
        this.tray.setImage(nativeImage.createFromPath(iconPath('recording')));
        this.tray.setToolTip(
          hk ? `Whisper App — Recording… (${hk} to stop)` : 'Whisper App — Recording…',
        );
        break;

      case 'processing':
        this.tray.setImage(nativeImage.createFromPath(iconPath('processing')));
        this.tray.setToolTip('Whisper App — Transcribing…');
        // Animate icon during processing
        let toggle = false;
        this.animationTimer = setInterval(() => {
          if (!this.tray) return;
          toggle = !toggle;
          const img = nativeImage.createFromPath(
            iconPath(toggle ? 'processing' : 'idle'),
          );
          this.tray.setImage(img);
        }, ANIMATION_INTERVAL_MS);
        break;

      case 'error':
        this.tray.setImage(nativeImage.createFromPath(iconPath('error')));
        this.tray.setToolTip('Whisper App — Error');
        // Auto-reset to idle after 3 seconds
        this.errorResetTimer = setTimeout(() => {
          this.setState('idle');
        }, 3000);
        break;
    }

    logger.debug(`Tray state: ${state}`);
  }

  /**
   * Build (or rebuild) the context menu from current config values.
   */
  buildContextMenu(config: Config): void {
    if (!this.tray) return;

    const currentModel = config.getModel();
    const currentMode = config.getOutputMode();

    const modelItems = VALID_MODELS.map(modelId => ({
      label: modelId.replace('mlx-community/', ''),
      type: 'radio' as const,
      checked: modelId === currentModel,
      click: () => {
        this.emit('modelChange', modelId as ModelId);
      },
    }));

    const outputModeItems: Electron.MenuItemConstructorOptions[] = [
      {
        label: 'Clipboard only',
        type: 'radio' as const,
        checked: currentMode === 'clipboard',
        click: () => this.emit('outputModeChange', 'clipboard' as OutputMode),
      },
      {
        label: 'Auto-type',
        type: 'radio' as const,
        checked: currentMode === 'autotype',
        click: () => this.emit('outputModeChange', 'autotype' as OutputMode),
      },
      {
        label: 'Both (clipboard + auto-type)',
        type: 'radio' as const,
        checked: currentMode === 'both',
        click: () => this.emit('outputModeChange', 'both' as OutputMode),
      },
    ];

    const menu = Menu.buildFromTemplate([
      { label: 'Whisper App', enabled: false },
      { type: 'separator' },
      { label: 'Model', enabled: false },
      ...modelItems,
      { type: 'separator' },
      { label: 'Output Mode', enabled: false },
      ...outputModeItems,
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => this.emit('quit'),
        accelerator: 'CmdOrCtrl+Q',
      },
    ]);

    this.tray.setContextMenu(menu);
  }

  /**
   * Destroy the tray icon and clean up.
   */
  destroy(): void {
    if (this.animationTimer) {
      clearInterval(this.animationTimer);
      this.animationTimer = null;
    }
    if (this.errorResetTimer) {
      clearTimeout(this.errorResetTimer);
      this.errorResetTimer = null;
    }
    if (this.tray) {
      this.tray.destroy();
      this.tray = null;
    }
    this.removeAllListeners();
    logger.info('TrayManager destroyed');
  }
}

/**
 * HotkeyManager — supports two interaction modes, chosen by the caller:
 *
 *   - "hold" (push-to-talk): press the chord to start, release to stop.
 *           Only available for modifier-only accelerators (e.g. "Option+Cmd"),
 *           because Electron's globalShortcut cannot observe key-release.
 *           Implemented via uiohook-napi.
 *   - "tap" (toggle): press once to start, press again to stop. Works for
 *           any accelerator (modifier-only or standard).
 *           Modifier-only "tap" is implemented via uiohook-napi (treats the
 *           chord-down edge as a toggle and ignores release). Standard
 *           accelerators use Electron's globalShortcut.
 *
 * If the caller requests "hold" with a non-modifier accelerator (e.g.
 * "Alt+Space"), HotkeyManager falls back to "tap" and logs a warning.
 *
 * Must be called inside app.whenReady().
 */

import { globalShortcut } from 'electron';
import type { HotkeyMode } from './types';
import * as logger from './logger';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface HotkeyHandlers {
  onPress: () => void;
  onRelease?: () => void;
}

export interface RegisterOptions {
  /** Interaction mode. Defaults to "hold" for back-compat. */
  mode?: HotkeyMode;
}

type ModifierName = 'cmd' | 'alt' | 'ctrl' | 'shift';

// Minimal shape of the uiohook-napi module we rely on
interface UiohookKeyboardEvent {
  altKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
}
interface UiohookModule {
  start(): void;
  stop(): void;
  on(event: string, listener: (e: UiohookKeyboardEvent) => void): void;
  off(event: string, listener: (e: UiohookKeyboardEvent) => void): void;
}

// ─── parseAccelerator ────────────────────────────────────────────────────────

/** Set of token strings that map to a modifier (all lowercase). */
const MODIFIER_TOKEN_MAP: Record<string, ModifierName> = {
  command: 'cmd',
  cmd: 'cmd',
  super: 'cmd',
  meta: 'cmd',
  cmdorctrl: 'cmd',
  commandorcontrol: 'cmd',
  control: 'ctrl',
  ctrl: 'ctrl',
  alt: 'alt',
  option: 'alt',
  altgr: 'alt',
  shift: 'shift',
};

export function parseAccelerator(accel: string): {
  modifiers: Set<ModifierName>;
  key: string | null;
} {
  const tokens = accel.split('+').map((t) => t.trim());
  const modifiers = new Set<ModifierName>();
  const nonModifiers: string[] = [];

  for (const token of tokens) {
    const lower = token.toLowerCase();
    if (lower in MODIFIER_TOKEN_MAP) {
      modifiers.add(MODIFIER_TOKEN_MAP[lower]);
    } else {
      nonModifiers.push(token);
    }
  }

  if (nonModifiers.length === 0) {
    return { modifiers, key: null };
  }
  if (nonModifiers.length > 1) {
    throw new Error(
      `parseAccelerator: more than one non-modifier token in "${accel}": ${nonModifiers.join(', ')}`
    );
  }
  return { modifiers, key: nonModifiers[0] };
}

// ─── HotkeyManager ───────────────────────────────────────────────────────────

export class HotkeyManager {
  private registeredAccelerator: string | null = null;
  private uiohookStarted = false;

  // Saved uiohook listener references so we can remove them later
  private uiohookKeydownListener: ((e: UiohookKeyboardEvent) => void) | null = null;
  private uiohookKeyupListener: ((e: UiohookKeyboardEvent) => void) | null = null;

  // ── register ──────────────────────────────────────────────────────────────

  register(
    accelerator: string,
    handlers: HotkeyHandlers,
    options: RegisterOptions = {},
  ): boolean {
    this.unregister();

    const { modifiers, key } = parseAccelerator(accelerator);
    const requestedMode: HotkeyMode = options.mode ?? 'hold';

    // ── Path A: modifier-only accelerator → uiohook ──────────────────────
    if (key === null && modifiers.size >= 1) {
      let uIOhook: UiohookModule;
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        uIOhook = require('uiohook-napi').uIOhook as UiohookModule;
      } catch (err) {
        logger.warn(`Failed to load uiohook-napi for hotkey "${accelerator}": ${err}`);
        return false;
      }

      if (!this.uiohookStarted) {
        uIOhook.start();
        this.uiohookStarted = true;
      }

      let chordHeld = false;

      const allHeld = (e: UiohookKeyboardEvent): boolean => {
        const has = (m: ModifierName) => modifiers.has(m);
        if (has('cmd')   && !e.metaKey)  return false;
        if (has('alt')   && !e.altKey)   return false;
        if (has('ctrl')  && !e.ctrlKey)  return false;
        if (has('shift') && !e.shiftKey) return false;
        return true;
      };

      const anyReleased = (e: UiohookKeyboardEvent): boolean => !allHeld(e);

      const keydownListener = (e: UiohookKeyboardEvent): void => {
        if (!chordHeld && allHeld(e)) {
          chordHeld = true;
          handlers.onPress();
        }
      };

      // In "hold" mode, releasing any chord key fires onRelease.
      // In "tap" mode, releases only reset the edge-detector — onPress
      // is called again on the next chord-down edge.
      const keyupListener = (e: UiohookKeyboardEvent): void => {
        if (chordHeld && anyReleased(e)) {
          chordHeld = false;
          if (requestedMode === 'hold') {
            handlers.onRelease?.();
          }
        }
      };

      uIOhook.on('keydown', keydownListener);
      uIOhook.on('keyup', keyupListener);

      this.uiohookKeydownListener = keydownListener;
      this.uiohookKeyupListener = keyupListener;
      this.registeredAccelerator = accelerator;

      logger.info(
        `Hotkey registered: ${accelerator} (${requestedMode === 'hold' ? 'hold-to-talk' : 'tap-to-toggle'})`,
      );
      return true;
    }

    // ── Path B: standard accelerator → globalShortcut (tap-only) ─────────
    if (requestedMode === 'hold') {
      logger.warn(
        `Hotkey "${accelerator}" includes a non-modifier key; "hold" mode is not supported. Falling back to "tap".`,
      );
    }
    const success = globalShortcut.register(accelerator, handlers.onPress);
    if (success) {
      this.registeredAccelerator = accelerator;
      logger.info(`Hotkey registered: ${accelerator} (tap-to-toggle)`);
    } else {
      logger.warn(`Failed to register hotkey: ${accelerator} (may already be in use)`);
    }
    return success;
  }

  // ── unregister ────────────────────────────────────────────────────────────

  unregister(): void {
    if (!this.registeredAccelerator) return;

    const accel = this.registeredAccelerator;
    this.registeredAccelerator = null;

    // Clean up uiohook listeners if present
    if (this.uiohookKeydownListener || this.uiohookKeyupListener) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const uIOhook = require('uiohook-napi').uIOhook as UiohookModule;
        if (this.uiohookKeydownListener) {
          uIOhook.off('keydown', this.uiohookKeydownListener);
        }
        if (this.uiohookKeyupListener) {
          uIOhook.off('keyup', this.uiohookKeyupListener);
        }
      } catch {
        // best effort
      }
      this.uiohookKeydownListener = null;
      this.uiohookKeyupListener = null;
    } else {
      // globalShortcut path
      globalShortcut.unregister(accel);
    }

    logger.info(`Hotkey unregistered: ${accel}`);
  }

  // ── unregisterAll ─────────────────────────────────────────────────────────

  unregisterAll(): void {
    this.unregister();
    globalShortcut.unregisterAll();

    if (this.uiohookStarted) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const uIOhook = require('uiohook-napi').uIOhook as UiohookModule;
        uIOhook.stop();
      } catch {
        // best effort
      }
      this.uiohookStarted = false;
    }

    this.registeredAccelerator = null;
  }
}

/**
 * Output module — delivers transcribed text via clipboard and/or AppleScript auto-type.
 * Clipboard is always written first; autotype is additive.
 * Gates autotype on Accessibility permission.
 */

import { execFile } from 'node:child_process';
import { clipboard, systemPreferences } from 'electron';
import { type OutputMode } from './types';
import * as logger from './logger';

/**
 * Write text to the macOS clipboard.
 */
export function writeToClipboard(text: string): void {
  clipboard.writeText(text);
}

/**
 * Auto-type text into the currently focused app via AppleScript.
 * Uses execFile (NOT exec) to avoid shell interpolation of special characters.
 */
export async function autotype(text: string): Promise<void> {
  // Escape backslashes and double-quotes for AppleScript string literal
  const escaped = text.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const script = `tell application "System Events" to keystroke "${escaped}"`;

  return new Promise<void>((resolve, reject) => {
    execFile('osascript', ['-e', script], (err) => {
      if (err) {
        logger.warn('autotype failed:', err.message);
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

/**
 * Deliver text according to the configured output mode.
 * - 'clipboard': write to clipboard only
 * - 'autotype': auto-type (with clipboard fallback if Accessibility denied)
 * - 'both': write to clipboard AND auto-type
 */
export async function deliver(text: string, mode: OutputMode): Promise<void> {
  const isTrusted = systemPreferences.isTrustedAccessibilityClient(false);

  if (mode === 'clipboard') {
    writeToClipboard(text);
    return;
  }

  if (mode === 'autotype') {
    if (!isTrusted) {
      logger.warn('Accessibility permission not granted; falling back to clipboard');
      writeToClipboard(text);
      return;
    }
    // Write to clipboard as fallback first, then autotype
    writeToClipboard(text);
    await autotype(text);
    return;
  }

  if (mode === 'both') {
    writeToClipboard(text);
    if (isTrusted) {
      await autotype(text);
    } else {
      logger.warn('Accessibility permission not granted; skipping autotype');
    }
    return;
  }
}

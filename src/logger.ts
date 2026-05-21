/**
 * Lightweight structured logger.
 * Writes to stdout and ~/Library/Logs/whisper-app/app.log
 * No external dependencies — uses Node built-ins only.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_DIR = path.join(os.homedir(), 'Library', 'Logs', 'whisper-app');
const LOG_FILE = path.join(LOG_DIR, 'app.log');

// Create log directory on module load
try {
  fs.mkdirSync(LOG_DIR, { recursive: true });
} catch {
  // Non-fatal — if we can't create the log dir, we still write to stdout
}

function log(level: LogLevel, msg: string, ...args: unknown[]): void {
  const timestamp = new Date().toISOString();
  const extra = args.length > 0
    ? ' ' + args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ')
    : '';
  const line = `[${timestamp}] [${level.toUpperCase().padEnd(5)}] ${msg}${extra}`;

  // Always write to stdout
  process.stdout.write(line + '\n');

  // Best-effort write to log file
  try {
    fs.appendFileSync(LOG_FILE, line + '\n');
  } catch {
    // Non-fatal
  }
}

export function debug(msg: string, ...args: unknown[]): void {
  log('debug', msg, ...args);
}

export function info(msg: string, ...args: unknown[]): void {
  log('info', msg, ...args);
}

export function warn(msg: string, ...args: unknown[]): void {
  log('warn', msg, ...args);
}

export function error(msg: string, ...args: unknown[]): void {
  log('error', msg, ...args);
}

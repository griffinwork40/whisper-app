/**
 * Startup checks for whisper-app.
 * Verifies Apple Silicon, Python + mlx_whisper, enumerates audio devices,
 * requests microphone permission.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { systemPreferences } from 'electron';
import { type DeviceInfo, type StartupResult, SetupError } from './types';
import * as logger from './logger';

const execFileAsync = promisify(execFile);

/**
 * Parse AVFoundation audio devices from ffmpeg -list_devices output.
 * ffmpeg prints device enumeration to STDERR.
 *
 * Example section:
 *   AVFoundation audio devices:
 *   [0] MacBook Pro Microphone
 *   [1] ZoomAudioDevice
 *
 * @param ffmpegOutput - Combined stderr/stdout from ffmpeg -list_devices
 * @returns Array of DeviceInfo objects (audio devices only)
 */
export function parseDevices(ffmpegOutput: string): DeviceInfo[] {
  const devices: DeviceInfo[] = [];
  const lines = ffmpegOutput.split('\n');

  // Find the start of the audio devices section.
  // ffmpeg output lines look like:
  //   [AVFoundation indev @ 0x1234abcd] AVFoundation audio devices:
  //   [AVFoundation indev @ 0x1234abcd] [0] MacBook Pro Microphone
  // The leading "[AVFoundation indev @ 0x...]" prefix must be stripped before
  // matching section headers and device index lines.
  let inAudioSection = false;
  const audioSectionHeader = /AVFoundation audio devices:/i;
  // Matches the optional "[AVFoundation indev @ 0x...] " prefix then [N] Name
  const deviceLine = /(?:\[AVFoundation[^\]]*\]\s*)?\[(\d+)\]\s+(.+?)\s*$/;

  for (const line of lines) {
    if (audioSectionHeader.test(line)) {
      inAudioSection = true;
      continue;
    }

    // If we hit a new section header (video or another), stop
    if (inAudioSection && /AVFoundation \w+ devices:/i.test(line)) {
      break;
    }

    if (inAudioSection) {
      const match = deviceLine.exec(line);
      if (match) {
        const index = parseInt(match[1], 10);
        const name = match[2].trim();
        devices.push({ index, name });
      }
    }
  }

  return devices;
}

/**
 * Select the preferred audio device from a list.
 * Prefers a device matching /MacBook Pro Microphone/.
 * Falls back to the first device (index 0) if no preferred device found.
 */
export function selectDevice(devices: DeviceInfo[]): DeviceInfo {
  if (devices.length === 0) {
    throw new SetupError(
      'No audio devices found',
      'No microphone detected. Please connect a microphone and restart.',
    );
  }

  // Prefer MacBook Pro Microphone
  const preferred = devices.find(d => /MacBook Pro Microphone/i.test(d.name));
  if (preferred) {
    return preferred;
  }

  // Fall back to the first device
  return devices[0];
}

/**
 * Run all startup checks.
 * Returns a StartupResult on success.
 * Throws SetupError with a user-facing message on failure.
 */
export async function runStartupChecks(): Promise<StartupResult> {
  // Step 1: Verify Apple Silicon
  if (process.arch !== 'arm64') {
    throw new SetupError(
      `Unsupported architecture: ${process.arch}`,
      'Whisper App requires Apple Silicon (M-series chip). This machine appears to be Intel-based.',
    );
  }
  logger.info('Architecture check: arm64 ✓');

  // Step 2: Resolve Python path
  let pythonPath: string;
  try {
    const { stdout } = await execFileAsync('which', ['python3']);
    pythonPath = stdout.trim();
    if (!pythonPath) {
      throw new Error('Empty path returned');
    }
  } catch {
    throw new SetupError(
      'python3 not found in PATH',
      'Python 3 is required. Install it via: brew install python3',
    );
  }
  logger.info(`Python path resolved: ${pythonPath}`);

  // Step 3: Verify mlx_whisper is importable
  try {
    await execFileAsync(pythonPath, ['-c', 'import mlx_whisper']);
  } catch {
    throw new SetupError(
      'mlx_whisper import failed',
      'The mlx-whisper package is not installed. Run: pip3 install mlx-whisper',
    );
  }
  logger.info('mlx_whisper import check ✓');

  // Step 4: Enumerate ffmpeg audio devices (output is on stderr)
  const FFMPEG = '/opt/homebrew/bin/ffmpeg';
  let deviceOutput = '';
  try {
    // ffmpeg -list_devices exits with code 1 even on success; capture stderr
    // Note: execFile does NOT invoke a shell, so -i must be an empty string '',
    // NOT '""' (which would pass the two-character literal "" to ffmpeg).
    const result = await execFileAsync(
      FFMPEG,
      ['-f', 'avfoundation', '-list_devices', 'true', '-i', ''],
    ).catch((err: { stderr?: string; stdout?: string }) => {
      // Expected: ffmpeg exits 1 when listing devices; grab the stderr output
      return {
        stdout: err.stdout ?? '',
        stderr: err.stderr ?? '',
      };
    });
    deviceOutput = (result.stderr ?? '') + (result.stdout ?? '');
  } catch (err) {
    throw new SetupError(
      `ffmpeg device enumeration failed: ${err}`,
      'Could not enumerate audio devices. Make sure ffmpeg is installed: brew install ffmpeg',
    );
  }

  const devices = parseDevices(deviceOutput);
  logger.info(`Found ${devices.length} audio device(s)`, devices);

  const selectedDevice = selectDevice(devices);
  logger.info(`Selected audio device: [${selectedDevice.index}] ${selectedDevice.name}`);

  // Step 5: Request microphone permission
  const granted = await systemPreferences.askForMediaAccess('microphone');
  if (!granted) {
    throw new SetupError(
      'Microphone permission denied',
      'Microphone access was denied. Please grant permission in System Settings → Privacy & Security → Microphone.',
    );
  }
  logger.info('Microphone permission granted ✓');

  return {
    pythonPath,
    deviceIndex: selectedDevice.index,
    deviceName: selectedDevice.name,
  };
}

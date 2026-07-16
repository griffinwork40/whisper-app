/**
 * Whisper App — Electron main process entry point.
 * Menu-bar only app: no Dock icon, no BrowserWindow, no renderer.
 *
 * State machine:
 *   idle ──[hotkey]──► recording ──[hotkey]──► processing ──► idle
 *   any ──[error]──► error ──[3s timeout]──► idle
 */

import { app, Notification } from 'electron';
import * as path from 'node:path';
import { type AppState, type HotkeyMode, type ModelId, type OutputMode, type SetupError } from './types';
import { Config } from './config';
import { TrayManager } from './tray';
import { AudioRecorder } from './recorder';
import { Transcriber } from './transcriber';
import { HotkeyManager } from './hotkey';
import { deliver } from './output';
import { playStartSound, playStopSound } from './sound';
import { runStartupChecks } from './startup';
import * as logger from './logger';

// ─── Single instance lock ─────────────────────────────────────────────────────
if (!app.requestSingleInstanceLock()) {
  logger.warn('Another instance is already running. Exiting.');
  app.quit();
}

// ─── Prevent Dock icon ────────────────────────────────────────────────────────
app.dock?.hide();

// ─── Main startup ─────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  logger.info('Whisper App starting…');

  // Run startup checks (arch, python, mlx_whisper, devices, mic permission)
  let startupResult;
  try {
    startupResult = await runStartupChecks();
    logger.info('Startup checks passed', startupResult);
  } catch (err) {
    const setupErr = err as SetupError;
    const userMsg = setupErr.userMessage ?? setupErr.message ?? 'Setup failed.';
    logger.error('Startup check failed:', userMsg);

    new Notification({
      title: 'Whisper App — Setup Error',
      body: userMsg,
    }).show();

    app.quit();
    return;
  }

  // Instantiate modules
  const config = new Config();
  const tray = new TrayManager();
  const recorder = new AudioRecorder();
  const transcriber = new Transcriber(
    startupResult.pythonPath,
    path.join(__dirname, '..', 'scripts', 'transcribe.py'),
  );
  const hotkey = new HotkeyManager();

  // Initialize tray
  tray.setHotkeyDisplay(config.getHotkey());
  tray.buildContextMenu(config);
  tray.setState('idle');

  // ─── Top-level state machine ─────────────────────────────────────────────
  let appState: AppState = 'idle';

  const startRecording = () => {
    appState = 'recording';
    tray.setState('recording');
    logger.info(`Starting recording on device [${startupResult.deviceIndex}] ${startupResult.deviceName}`);
    recorder.start(startupResult.deviceIndex);
    if (config.getPlaySounds()) playStartSound();
  };

  const stopRecording = async () => {
    appState = 'processing';
    tray.setState('processing');
    logger.info('Stopping recording, starting transcription…');

    try {
      const wavPath = await recorder.stop();
      if (config.getPlaySounds()) playStopSound();
      logger.info(`Recording saved to: ${wavPath}`);

      const text = await transcriber.transcribe(
        wavPath,
        config.getModel(),
        config.getLanguage(),
      );
      logger.info(`Transcription complete: "${text.substring(0, 80)}${text.length > 80 ? '…' : ''}"`);

      if (text.length === 0) {
        // Silence-gate or hallucination filter dropped the result. Don't
        // clobber the clipboard or auto-type an empty string.
        logger.info('No speech detected — skipping delivery');
      } else {
        await deliver(text, config.getOutputMode());
        logger.info('Text delivered to output');
      }

      appState = 'idle';
      tray.setState('idle');

    } catch (err) {
      const errMsg = (err as Error).message ?? 'Unknown transcription error';
      logger.error('Transcription/delivery error:', errMsg);

      appState = 'error';
      tray.setState('error');

      new Notification({
        title: 'Transcription failed',
        body: errMsg,
      }).show();

      // Tray automatically resets to idle after 3 seconds (see tray.ts)
      setTimeout(() => {
        appState = 'idle';
      }, 3000);
    }
  };

  const onPress = async () => {
    if (appState === 'idle') {
      startRecording();
    } else if (appState === 'recording') {
      // Handles two cases:
      //   1. Toggle accelerator (e.g. Control+Alt+Shift+D): globalShortcut fires again on second press.
      //   2. Modifier-only hold mode (e.g. Option+Cmd): tray click reaches onPress while recording,
      //      so we treat it as a stop to keep tray-click toggle working in hold mode.
      await stopRecording();
    } else {
      logger.debug(`onPress called in state "${appState}" — ignoring`);
    }
  };

  const onRelease = async () => {
    if (appState === 'recording') {
      await stopRecording();
    }
    // Defensive: if we're already in processing/error/idle (e.g. stop was already
    // triggered), silently ignore. Press→release is atomic so this shouldn't happen
    // in practice, but guard anyway.
  };

  // ─── Wire up events ───────────────────────────────────────────────────────
  hotkey.register(config.getHotkey(), { onPress, onRelease }, { mode: config.getHotkeyMode() });
  // Recording is hotkey-only by design; the tray icon does not toggle recording.
  // Left-clicking the tray icon opens the context menu.
  tray.on('quit', () => {
    logger.info('Quit requested from tray menu');
    app.quit();
  });
  tray.on('modelChange', (model: ModelId) => {
    logger.info(`Model changed to: ${model}`);
    config.setModel(model);
    tray.buildContextMenu(config);
  });
  tray.on('outputModeChange', (mode: OutputMode) => {
    logger.info(`Output mode changed to: ${mode}`);
    config.setOutputMode(mode);
    tray.buildContextMenu(config);
  });
  tray.on('soundsToggle', (enabled: boolean) => {
    logger.info(`Play sounds ${enabled ? 'enabled' : 'disabled'}`);
    config.setPlaySounds(enabled);
    tray.buildContextMenu(config);
  });
  tray.on('hotkeyModeChange', (mode: HotkeyMode) => {
    logger.info(`Hotkey mode changed to: ${mode}`);
    config.setHotkeyMode(mode);
    // Re-register hotkey with the new mode. If the user is mid-recording,
    // stop cleanly first so we don't strand the state machine.
    if (appState === 'recording') {
      void stopRecording();
    }
    hotkey.register(config.getHotkey(), { onPress, onRelease }, { mode });
    tray.buildContextMenu(config);
  });

  // ─── Cleanup on quit ──────────────────────────────────────────────────────
  app.on('will-quit', () => {
    hotkey.unregisterAll();
    tray.destroy();
    logger.info('Whisper App shutting down cleanly');
  });

  logger.info(`Whisper App ready. Hotkey: ${config.getHotkey()}`);
});

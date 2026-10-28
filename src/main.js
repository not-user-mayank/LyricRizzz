const { app, BrowserWindow, dialog, globalShortcut, ipcMain, screen } = require('electron');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { startMediaSessionService, stopMediaSessionService } = require('./mediaSessionService');
const { getLyrics, extractLrcMetadata, makeLocalBaseName, sanitizeLocalBaseName } = require('./lyricsEngine');
const themes = require('../themes/themes.json');

const DEFAULT_SETTINGS = {
  theme: 'dark-glass',
  backgroundImagePath: '',
  backgroundBlur: 8,
  backgroundDim: 35,
  lyricColorMode: 'solid',
  currentColor: '',
  nextColor: '',
  gradientStart: '#ff8a3d',
  gradientEnd: '#ff4f9a',
  gradientAngle: 35,
  glow: true,
  fontSize: 23,
  widgetOpacity: 0.94,
  widgetBounds: null,
  offsetMs: 0,
  lockPosition: false,
};

let lyricsWindow;
let clickThrough = false;
let stopListeningForMedia;
let mediaShutdownStarted = false;
let mediaShutdownComplete = false;
let currentTrackKey = '';
let lyricsRequestId = 0;
let lyricsDirectory;
let rendererReady = false;
let latestMediaSession = null;
let latestLyrics = { lines: [], message: '♪ Waiting for song...' };
let settingsWindow;
let settingsStore;
let currentSettings = { ...DEFAULT_SETTINGS };
let backgroundDirectory;
let preferencesWriteTimer;
let trackOffsets = {};
let currentTrackOffsetMs = 0;

function normalizeSettings(input = {}) {
  if (!input || typeof input !== 'object') input = {};
  const color = (value, fallback) => /^#[0-9a-f]{6}$/i.test(value || '') ? value : fallback;
  const number = (value, fallback, min, max) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
  };
  const theme = themes.some((item) => item.id === input.theme) ? input.theme : DEFAULT_SETTINGS.theme;
  const mode = input.lyricColorMode === 'gradient' ? 'gradient' : 'solid';
  return {
    theme,
    backgroundImagePath: typeof input.backgroundImagePath === 'string' ? input.backgroundImagePath : '',
    backgroundBlur: number(input.backgroundBlur, DEFAULT_SETTINGS.backgroundBlur, 0, 30),
    backgroundDim: number(input.backgroundDim, DEFAULT_SETTINGS.backgroundDim, 0, 90),
    lyricColorMode: mode,
    currentColor: color(input.currentColor, ''),
    nextColor: color(input.nextColor, ''),
    gradientStart: color(input.gradientStart, DEFAULT_SETTINGS.gradientStart),
    gradientEnd: color(input.gradientEnd, DEFAULT_SETTINGS.gradientEnd),
    gradientAngle: number(input.gradientAngle, DEFAULT_SETTINGS.gradientAngle, 0, 360),
    glow: typeof input.glow === 'boolean' ? input.glow : DEFAULT_SETTINGS.glow,
    fontSize: number(input.fontSize, DEFAULT_SETTINGS.fontSize, 12, 48),
    widgetOpacity: number(input.widgetOpacity, DEFAULT_SETTINGS.widgetOpacity, 0.25, 1),
    widgetBounds: input.widgetBounds && typeof input.widgetBounds === 'object'
      ? {
        x: number(input.widgetBounds.x, 0, -20_000, 20_000),
        y: number(input.widgetBounds.y, 0, -20_000, 20_000),
        width: number(input.widgetBounds.width, 460, 280, 900),
        height: number(input.widgetBounds.height, 178, 120, 500),
      }
      : null,
    offsetMs: Math.round(number(input.offsetMs, DEFAULT_SETTINGS.offsetMs, -10_000, 10_000) / 500) * 500,
    lockPosition: typeof input.lockPosition === 'boolean' ? input.lockPosition : DEFAULT_SETTINGS.lockPosition,
  };
}

function getRestoredWidgetBounds() {
  const bounds = currentSettings.widgetBounds;
  if (!bounds) return null;
  const visibleOnDisplay = screen.getAllDisplays().some(({ workArea }) => {
    const visibleWidth = Math.min(bounds.x + bounds.width, workArea.x + workArea.width) - Math.max(bounds.x, workArea.x);
    const visibleHeight = Math.min(bounds.y + bounds.height, workArea.y + workArea.height) - Math.max(bounds.y, workArea.y);
    return visibleWidth >= 120 && visibleHeight >= 60;
  });
  return visibleOnDisplay ? bounds : null;
}

function schedulePreferencesSave() {
  clearTimeout(preferencesWriteTimer);
  preferencesWriteTimer = setTimeout(() => {
    settingsStore?.set('settings', currentSettings);
    preferencesWriteTimer = undefined;
  }, 250);
}

async function backgroundAsDataUrl(filePath) {
  if (!filePath) return '';
  const extension = path.extname(filePath).toLowerCase();
  const mimeType = ({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' })[extension];
  if (!mimeType) return '';
  try {
    const bytes = await fs.readFile(filePath);
    return `data:${mimeType};base64,${bytes.toString('base64')}`;
  } catch {
    return '';
  }
}

async function settingsSnapshot() {
  return {
    settings: { ...currentSettings, offsetMs: currentTrackOffsetMs },
    themes,
    backgroundDataUrl: await backgroundAsDataUrl(currentSettings.backgroundImagePath),
  };
}

async function broadcastSettings() {
  const snapshot = await settingsSnapshot();
  for (const window of [lyricsWindow, settingsWindow]) {
    if (window && !window.isDestroyed() && !window.webContents.isLoadingMainFrame()) {
      window.webContents.send('settings:changed', snapshot);
    }
  }
}

function isBackgroundPath(filePath) {
  const root = `${path.resolve(backgroundDirectory)}${path.sep}`.toLowerCase();
  return typeof filePath === 'string' && path.resolve(filePath).toLowerCase().startsWith(root);
}

function createSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    if (settingsWindow.isMinimized()) settingsWindow.restore();
    settingsWindow.show();
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 820,
    height: 780,
    minWidth: 680,
    minHeight: 620,
    title: 'Lyricrizzz Settings',
    parent: lyricsWindow || undefined,
    show: false,
    backgroundColor: '#11131b',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  settingsWindow.loadFile(path.join(__dirname, 'settings.html'));
  settingsWindow.once('ready-to-show', () => settingsWindow.show());
  settingsWindow.on('closed', () => { settingsWindow = null; });
}

function createLyricsWindow() {
  const savedBounds = getRestoredWidgetBounds();
  lyricsWindow = new BrowserWindow({
    ...(savedBounds || { width: 460, height: 178 }),
    minWidth: 280,
    minHeight: 120,
    maxWidth: 900,
    maxHeight: 500,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    minimizable: true,
    maximizable: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  lyricsWindow.setAlwaysOnTop(true, 'screen-saver');
  lyricsWindow.setMovable(!currentSettings.lockPosition);
  lyricsWindow.on('move', persistWidgetBounds);
  lyricsWindow.on('resize', persistWidgetBounds);
  lyricsWindow.webContents.on('did-start-loading', () => { rendererReady = false; });
  lyricsWindow.webContents.on('did-finish-load', () => {
    rendererReady = true;
    lyricsWindow.webContents.send('media-session:changed', latestMediaSession);
    lyricsWindow.webContents.send('lyrics:changed', latestLyrics);
    lyricsWindow.webContents.send('widget:click-through-changed', clickThrough);
    void broadcastSettings();
  });
  lyricsWindow.loadFile(path.join(__dirname, 'lyrics.html'));
  lyricsWindow.once('ready-to-show', () => lyricsWindow.show());
  lyricsWindow.on('closed', () => { lyricsWindow = null; });
}

function persistWidgetBounds() {
  if (!lyricsWindow || lyricsWindow.isDestroyed()) return;
  currentSettings.widgetBounds = lyricsWindow.getBounds();
  schedulePreferencesSave();
}

ipcMain.handle('widget:set-opacity', (_event, value) => {
  if (!lyricsWindow || typeof value !== 'number' || !Number.isFinite(value)) return;
  currentSettings.widgetOpacity = Math.min(1, Math.max(0.25, value));
  lyricsWindow.setOpacity(currentSettings.widgetOpacity);
  schedulePreferencesSave();
});

ipcMain.handle('widget:minimize', () => lyricsWindow?.minimize());
ipcMain.handle('widget:close', () => lyricsWindow?.close());
ipcMain.handle('widget:set-offset', (_event, value) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return currentTrackOffsetMs;
  currentTrackOffsetMs = Math.round(Math.min(30_000, Math.max(-30_000, value)) / 100) * 100;
  currentSettings.offsetMs = currentTrackOffsetMs;
  if (currentTrackKey) {
    trackOffsets[currentTrackKey] = currentTrackOffsetMs;
    settingsStore?.set('trackOffsets', trackOffsets);
  }
  schedulePreferencesSave();
  return currentTrackOffsetMs;
});
ipcMain.handle('lyrics:retry', () => {
  if (latestMediaSession && (latestMediaSession.title || latestMediaSession.artist)) {
    loadLyricsForSession(latestMediaSession);
    return true;
  }
  return false;
});
ipcMain.handle('widget:set-position-lock', (_event, enabled) => {
  if (typeof enabled !== 'boolean' || !lyricsWindow) return currentSettings.lockPosition;
  currentSettings.lockPosition = enabled;
  lyricsWindow.setMovable(!enabled);
  settingsStore?.set('settings', currentSettings);
  return currentSettings.lockPosition;
});

function sendMediaSession(session) {
  if (!lyricsWindow || lyricsWindow.isDestroyed()) return;
  const trackKey = session
    ? `${String(session.artist || '').normalize('NFC').trim().toLocaleLowerCase()}\u001f${String(session.title || '').normalize('NFC').trim().toLocaleLowerCase()}`
    : '';
  const trackChanged = trackKey !== currentTrackKey;
  if (trackChanged) {
    currentTrackKey = trackKey;
    currentTrackOffsetMs = trackOffsets[trackKey] || 0;
  }
  latestMediaSession = session ? { ...session, lyricOffsetMs: currentTrackOffsetMs } : null;
  if (rendererReady) lyricsWindow.webContents.send('media-session:changed', latestMediaSession);
  if (!trackChanged) return;

  if (!session || (!session.title && !session.artist)) {
    lyricsRequestId += 1;
    latestLyrics = { lines: [], message: '♪ Waiting for song...' };
    if (rendererReady) lyricsWindow.webContents.send('lyrics:changed', latestLyrics);
    return;
  }

  loadLyricsForSession(session);
}

function loadLyricsForSession(session) {
  const requestId = ++lyricsRequestId;
  latestLyrics = { lines: [], message: 'Looking for lyrics...' };
  if (rendererReady) lyricsWindow.webContents.send('lyrics:changed', latestLyrics);
  getLyrics(session, lyricsDirectory).then((lyrics) => {
    if (requestId === lyricsRequestId && lyricsWindow && !lyricsWindow.isDestroyed()) {
      latestLyrics = lyrics;
      if (rendererReady) lyricsWindow.webContents.send('lyrics:changed', lyrics);
    }
  });
}

async function importLyricsPaths(sourcePaths) {
  if (!Array.isArray(sourcePaths) || sourcePaths.length === 0) return { message: 'No lyric files selected.' };
  if (sourcePaths.length > 20) return { message: 'Add up to 20 lyric files at a time.' };
  await fs.mkdir(lyricsDirectory, { recursive: true });

  const currentTrack = latestMediaSession && (latestMediaSession.artist || latestMediaSession.title)
    ? latestMediaSession
    : null;
  const useCurrentTrackName = sourcePaths.length === 1 && currentTrack;
  const outcomes = [];

  for (const sourcePathValue of sourcePaths) {
    try {
      const rawSourcePath = String(sourcePathValue || '');
      if (!path.isAbsolute(rawSourcePath)) {
        outcomes.push(`${path.basename(rawSourcePath || 'file')}: choose a local file.`);
        continue;
      }
      const sourcePath = path.resolve(rawSourcePath);
      const extension = path.extname(sourcePath).toLowerCase();
      if (!['.lrc', '.srt', '.txt'].includes(extension)) {
        outcomes.push(extension === '.pdf'
          ? `${path.basename(sourcePath)}: PDF lyrics are not supported. Convert the file to .lrc, .srt, or .txt.`
          : `${path.basename(sourcePath || 'file')}: choose an .lrc, .srt, or .txt file.`);
        continue;
      }

      const stat = await fs.stat(sourcePath);
      if (!stat.isFile() || stat.size > 5 * 1024 * 1024) {
        outcomes.push(`${path.basename(sourcePath)}: the file is not a regular lyrics file or is larger than 5 MB.`);
        continue;
      }
      const content = await fs.readFile(sourcePath);
      let baseName = '';
      if (extension === '.lrc') {
        const metadata = extractLrcMetadata(content.toString('utf8'));
        if (metadata.artist && metadata.title) baseName = makeLocalBaseName(metadata.artist, metadata.title);
      }
      if (!baseName && useCurrentTrackName) baseName = makeLocalBaseName(currentTrack.artist, currentTrack.title);
      if (!baseName) baseName = sanitizeLocalBaseName(path.basename(sourcePath, extension));
      if (!baseName) {
        outcomes.push(`${path.basename(sourcePath)}: could not determine a file name.`);
        continue;
      }

      const targetPath = path.join(lyricsDirectory, `${baseName}${extension}`);
      let shouldWrite = true;
      try {
        const existing = await fs.readFile(targetPath);
        if (existing.equals(content)) {
          outcomes.push(`Already added: ${baseName}${extension}`);
          continue;
        }
        const answer = await dialog.showMessageBox(lyricsWindow, {
          type: 'question',
          title: 'Replace local lyrics?',
          message: `${baseName}${extension} already exists. Replace it with this file?`,
          buttons: ['Replace', 'Keep existing'],
          defaultId: 1,
          cancelId: 1,
        });
        shouldWrite = answer.response === 0;
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }

      if (!shouldWrite) {
        outcomes.push(`Kept existing file: ${baseName}${extension}`);
        continue;
      }
      await fs.writeFile(targetPath, content);
      outcomes.push(`Added: ${baseName}${extension}`);
    } catch (error) {
      outcomes.push(`${path.basename(String(sourcePathValue || 'file'))}: ${error.message}`);
    }
  }

  const currentBase = currentTrack ? makeLocalBaseName(currentTrack.artist, currentTrack.title).toLocaleLowerCase() : '';
  if (currentTrack && outcomes.some((outcome) => {
    const normalized = outcome.toLocaleLowerCase();
    return normalized.startsWith(`added: ${currentBase}.`)
      || normalized.startsWith(`kept existing file: ${currentBase}.`)
      || normalized.startsWith(`already added: ${currentBase}.`);
  })) {
    loadLyricsForSession(currentTrack);
  }
  return { message: outcomes.join('\n') || 'No files were added.' };
}

ipcMain.handle('lyrics:choose-file', async () => {
  const selection = await dialog.showOpenDialog(lyricsWindow, {
    title: 'Add local lyrics',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Lyrics files', extensions: ['lrc', 'srt', 'txt'] }],
  });
  if (selection.canceled) return { message: 'Import cancelled.' };
  return importLyricsPaths(selection.filePaths);
});

ipcMain.handle('lyrics:import-dropped', (_event, sourcePaths) => importLyricsPaths(sourcePaths));

ipcMain.handle('widget:open-settings', () => createSettingsWindow());
ipcMain.handle('settings:get', () => settingsSnapshot());
ipcMain.handle('settings:save', async (_event, input) => {
  const updated = normalizeSettings(input);
  if (updated.backgroundImagePath) {
    if (!isBackgroundPath(updated.backgroundImagePath)) {
      throw new Error('Choose a background image using the Settings window.');
    }
    if (!['.png', '.jpg', '.jpeg', '.webp'].includes(path.extname(updated.backgroundImagePath).toLowerCase())) {
      throw new Error('Choose a PNG, JPG, or WebP background image.');
    }
    const stat = await fs.stat(updated.backgroundImagePath);
    if (!stat.isFile() || stat.size > 12 * 1024 * 1024) throw new Error('The selected background image is missing or larger than 12 MB.');
  }
  clearTimeout(preferencesWriteTimer);
  preferencesWriteTimer = undefined;
  updated.widgetBounds = currentSettings.widgetBounds;
  updated.offsetMs = currentTrackOffsetMs;
  updated.lockPosition = currentSettings.lockPosition;
  currentSettings = updated;
  settingsStore.set('settings', currentSettings);
  if (lyricsWindow && !lyricsWindow.isDestroyed()) lyricsWindow.setOpacity(currentSettings.widgetOpacity);
  await broadcastSettings();
  return settingsSnapshot();
});

ipcMain.handle('settings:choose-background', async () => {
  const selection = await dialog.showOpenDialog(settingsWindow || lyricsWindow, {
    title: 'Choose a custom background',
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
  });
  if (selection.canceled) return { canceled: true };

  const sourcePath = selection.filePaths[0];
  const extension = path.extname(sourcePath).toLowerCase();
  if (!['.png', '.jpg', '.jpeg', '.webp'].includes(extension)) throw new Error('Choose a PNG, JPG, or WebP image.');
  const stat = await fs.stat(sourcePath);
  if (!stat.isFile() || stat.size > 12 * 1024 * 1024) {
    throw new Error('Choose an image file no larger than 12 MB.');
  }
  await fs.mkdir(backgroundDirectory, { recursive: true });
  const destination = path.join(backgroundDirectory, `background-${randomUUID()}${extension}`);
  await fs.copyFile(sourcePath, destination);
  return {
    backgroundImagePath: destination,
    backgroundDataUrl: await backgroundAsDataUrl(destination),
    fileName: path.basename(sourcePath),
  };
});

ipcMain.handle('settings:reset', async () => {
  clearTimeout(preferencesWriteTimer);
  preferencesWriteTimer = undefined;
  currentSettings = { ...DEFAULT_SETTINGS };
  trackOffsets = {};
  currentTrackOffsetMs = 0;
  settingsStore.set('trackOffsets', trackOffsets);
  settingsStore.set('settings', currentSettings);
  if (lyricsWindow && !lyricsWindow.isDestroyed()) lyricsWindow.setOpacity(currentSettings.widgetOpacity);
  if (lyricsWindow && !lyricsWindow.isDestroyed()) lyricsWindow.setMovable(true);
  await broadcastSettings();
  return settingsSnapshot();
});

ipcMain.handle('widget:resize', (_event, direction) => {
  if (!lyricsWindow) return;
  const bounds = lyricsWindow.getBounds();
  const factor = direction === 'larger' ? 1.1 : direction === 'smaller' ? 0.9 : 1;
  const width = Math.min(900, Math.max(280, Math.round(bounds.width * factor)));
  const height = Math.min(500, Math.max(120, Math.round(bounds.height * factor)));
  lyricsWindow.setSize(width, height, true);
});

ipcMain.handle('widget:set-click-through', (_event, enabled) => {
  if (!lyricsWindow || typeof enabled !== 'boolean') return;
  clickThrough = enabled;
  lyricsWindow.setIgnoreMouseEvents(clickThrough, { forward: true });
  return clickThrough;
});

app.whenReady().then(async () => {
  const { default: ElectronStore } = await import('electron-store');
  settingsStore = new ElectronStore({ name: 'preferences', defaults: { settings: DEFAULT_SETTINGS } });
  currentSettings = normalizeSettings(settingsStore.get('settings', DEFAULT_SETTINGS));
  const savedTrackOffsets = settingsStore.get('trackOffsets', {});
  trackOffsets = savedTrackOffsets && typeof savedTrackOffsets === 'object' && !Array.isArray(savedTrackOffsets)
    ? Object.fromEntries(Object.entries(savedTrackOffsets)
      .filter(([key, value]) => key.length <= 500 && Number.isFinite(value))
      .map(([key, value]) => [key, Math.round(Math.min(30_000, Math.max(-30_000, value)) / 100) * 100]))
    : {};
  currentTrackOffsetMs = 0;
  backgroundDirectory = path.join(app.getPath('userData'), 'backgrounds');
  if (currentSettings.backgroundImagePath && !isBackgroundPath(currentSettings.backgroundImagePath)) {
    currentSettings.backgroundImagePath = '';
  }
  lyricsDirectory = path.join(app.getPath('documents'), 'FloatingLyrics', 'LocalLyrics');
  fs.mkdir(lyricsDirectory, { recursive: true }).catch((error) => {
    console.error('Could not create the local lyrics folder:', error.message);
  });
  createLyricsWindow();
  lyricsWindow.setOpacity(currentSettings.widgetOpacity);
  stopListeningForMedia = startMediaSessionService(sendMediaSession, (error) => {
    console.error('Windows media detection could not start:', error.message);
    sendMediaSession(null);
  });
  globalShortcut.register('Control+Shift+L', () => {
    if (!lyricsWindow) return;
    clickThrough = !clickThrough;
    lyricsWindow.setIgnoreMouseEvents(clickThrough, { forward: true });
    if (rendererReady) lyricsWindow.webContents.send('widget:click-through-changed', clickThrough);
  });
  globalShortcut.register('Control+Shift+M', () => {
    if (!lyricsWindow) return;
    if (lyricsWindow.isMinimized()) lyricsWindow.restore();
    lyricsWindow.show();
    lyricsWindow.focus();
  });
}).catch((error) => {
  console.error('Lyricrizzz could not start:', error);
  app.quit();
});

app.on('before-quit', (event) => {
  if (mediaShutdownComplete) return;
  event.preventDefault();
  if (mediaShutdownStarted) return;
  mediaShutdownStarted = true;
  clearTimeout(preferencesWriteTimer);
  if (preferencesWriteTimer) settingsStore?.set('settings', currentSettings);
  preferencesWriteTimer = undefined;
  stopListeningForMedia?.();
  globalShortcut.unregisterAll();
  stopMediaSessionService()
    .catch((error) => console.error('Could not stop Windows media detection cleanly:', error.message))
    .finally(() => {
      mediaShutdownComplete = true;
      app.quit();
    });
});
app.on('window-all-closed', () => app.quit());

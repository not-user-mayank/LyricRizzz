const { app, BrowserWindow, globalShortcut, ipcMain } = require('electron');
const path = require('node:path');
const { startMediaSessionService, stopMediaSessionService } = require('./mediaSessionService');
const { getLyrics } = require('./lyricsEngine');

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

function createLyricsWindow() {
  lyricsWindow = new BrowserWindow({
    width: 460,
    height: 178,
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
  lyricsWindow.webContents.on('did-start-loading', () => { rendererReady = false; });
  lyricsWindow.webContents.on('did-finish-load', () => {
    rendererReady = true;
    lyricsWindow.webContents.send('media-session:changed', latestMediaSession);
    lyricsWindow.webContents.send('lyrics:changed', latestLyrics);
    lyricsWindow.webContents.send('widget:click-through-changed', clickThrough);
  });
  lyricsWindow.loadFile(path.join(__dirname, 'lyrics.html'));
  lyricsWindow.once('ready-to-show', () => lyricsWindow.show());
  lyricsWindow.on('closed', () => { lyricsWindow = null; });
}

ipcMain.handle('widget:set-opacity', (_event, value) => {
  if (!lyricsWindow || typeof value !== 'number' || !Number.isFinite(value)) return;
  lyricsWindow.setOpacity(Math.min(1, Math.max(0.25, value)));
});

ipcMain.handle('widget:minimize', () => lyricsWindow?.minimize());
ipcMain.handle('widget:close', () => lyricsWindow?.close());

function sendMediaSession(session) {
  if (!lyricsWindow || lyricsWindow.isDestroyed()) return;
  latestMediaSession = session;
  if (rendererReady) lyricsWindow.webContents.send('media-session:changed', session);

  const trackKey = session
    ? `${String(session.artist || '').trim().toLocaleLowerCase()}\u001f${String(session.title || '').trim().toLocaleLowerCase()}`
    : '';
  if (trackKey === currentTrackKey) return;
  currentTrackKey = trackKey;
  const requestId = ++lyricsRequestId;

  if (!session || (!session.title && !session.artist)) {
    latestLyrics = { lines: [], message: '♪ Waiting for song...' };
    if (rendererReady) lyricsWindow.webContents.send('lyrics:changed', latestLyrics);
    return;
  }

  latestLyrics = { lines: [], message: 'Looking for lyrics...' };
  if (rendererReady) lyricsWindow.webContents.send('lyrics:changed', latestLyrics);
  getLyrics(session, lyricsDirectory).then((lyrics) => {
    if (requestId === lyricsRequestId && lyricsWindow && !lyricsWindow.isDestroyed()) {
      latestLyrics = lyrics;
      if (rendererReady) lyricsWindow.webContents.send('lyrics:changed', lyrics);
    }
  });
}

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

app.whenReady().then(() => {
  lyricsDirectory = path.join(app.getPath('documents'), 'FloatingLyrics', 'LocalLyrics');
  createLyricsWindow();
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
});

app.on('before-quit', (event) => {
  if (mediaShutdownComplete) return;
  event.preventDefault();
  if (mediaShutdownStarted) return;
  mediaShutdownStarted = true;
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

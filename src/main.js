const { app, BrowserWindow, dialog, globalShortcut, ipcMain } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { startMediaSessionService, stopMediaSessionService } = require('./mediaSessionService');
const { getLyrics, extractLrcMetadata, makeLocalBaseName, sanitizeLocalBaseName } = require('./lyricsEngine');

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
  fs.mkdir(lyricsDirectory, { recursive: true }).catch((error) => {
    console.error('Could not create the local lyrics folder:', error.message);
  });
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

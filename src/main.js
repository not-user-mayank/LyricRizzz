const { app, BrowserWindow, globalShortcut, ipcMain } = require('electron');
const path = require('node:path');

let lyricsWindow;
let clickThrough = false;

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
  createLyricsWindow();
  globalShortcut.register('Control+Shift+L', () => {
    if (!lyricsWindow) return;
    clickThrough = !clickThrough;
    lyricsWindow.setIgnoreMouseEvents(clickThrough, { forward: true });
    lyricsWindow.webContents.send('widget:click-through-changed', clickThrough);
  });
});

app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => app.quit());

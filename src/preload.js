const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('lyricrizzz', {
  setOpacity: (value) => ipcRenderer.invoke('widget:set-opacity', value),
  resize: (direction) => ipcRenderer.invoke('widget:resize', direction),
  minimize: () => ipcRenderer.invoke('widget:minimize'),
  close: () => ipcRenderer.invoke('widget:close'),
  setClickThrough: (enabled) => ipcRenderer.invoke('widget:set-click-through', enabled),
  onMediaSessionChanged: (callback) => {
    ipcRenderer.on('media-session:changed', (_event, session) => callback(session));
  },
  onLyricsChanged: (callback) => {
    ipcRenderer.on('lyrics:changed', (_event, lyrics) => callback(lyrics));
  },
  chooseLyricsFile: () => ipcRenderer.invoke('lyrics:choose-file'),
  importDroppedFiles: (paths) => ipcRenderer.invoke('lyrics:import-dropped', paths),
  getDroppedFilePath: (file) => webUtils.getPathForFile(file),
  onClickThroughChanged: (callback) => {
    ipcRenderer.on('widget:click-through-changed', (_event, enabled) => callback(enabled));
  },
});

const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('lyricrizzz', {
  setOpacity: (value) => ipcRenderer.invoke('widget:set-opacity', value),
  resize: (direction) => ipcRenderer.invoke('widget:resize', direction),
  minimize: () => ipcRenderer.invoke('widget:minimize'),
  close: () => ipcRenderer.invoke('widget:close'),
  setOffset: (value) => ipcRenderer.invoke('widget:set-offset', value),
  retryLyrics: () => ipcRenderer.invoke('lyrics:retry'),
  setPositionLock: (enabled) => ipcRenderer.invoke('widget:set-position-lock', enabled),
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
  openSettings: () => ipcRenderer.invoke('widget:open-settings'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
  chooseBackground: () => ipcRenderer.invoke('settings:choose-background'),
  resetSettings: () => ipcRenderer.invoke('settings:reset'),
  onSettingsChanged: (callback) => {
    ipcRenderer.on('settings:changed', (_event, snapshot) => callback(snapshot));
  },
  onClickThroughChanged: (callback) => {
    ipcRenderer.on('widget:click-through-changed', (_event, enabled) => callback(enabled));
  },
});

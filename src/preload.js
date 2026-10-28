const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lyricrizzz', {
  setOpacity: (value) => ipcRenderer.invoke('widget:set-opacity', value),
  resize: (direction) => ipcRenderer.invoke('widget:resize', direction),
  minimize: () => ipcRenderer.invoke('widget:minimize'),
  close: () => ipcRenderer.invoke('widget:close'),
  setClickThrough: (enabled) => ipcRenderer.invoke('widget:set-click-through', enabled),
  onMediaSessionChanged: (callback) => {
    ipcRenderer.on('media-session:changed', (_event, session) => callback(session));
  },
  onClickThroughChanged: (callback) => {
    ipcRenderer.on('widget:click-through-changed', (_event, enabled) => callback(enabled));
  },
});

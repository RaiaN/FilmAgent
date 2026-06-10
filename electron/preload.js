const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  pickFolder: ({ mode } = {}) => ipcRenderer.invoke('film:pickFolder', { mode }),
});

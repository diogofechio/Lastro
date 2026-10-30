const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lastroDesktop', {
  openCompactWindow: () => ipcRenderer.invoke('lastro:open-compact'),
  openMainWindow: () => ipcRenderer.invoke('lastro:open-main'),
  closeCompactWindow: () => ipcRenderer.invoke('lastro:close-compact')
});

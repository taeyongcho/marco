'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('gen', {
  authState: () => ipcRenderer.invoke('auth:state'),
  unlock: (pw) => ipcRenderer.invoke('auth:unlock', pw),
  lock: () => ipcRenderer.invoke('auth:lock'),
  changePassword: (cur, next) => ipcRenderer.invoke('auth:change', cur, next),
  generate: (u, kind, e, m) => ipcRenderer.invoke('gen', u, kind, e, m),
  history: () => ipcRenderer.invoke('history'),
  clearHistory: () => ipcRenderer.invoke('history:clear'),
  copy: (t) => ipcRenderer.invoke('copy', t),
  saveText: (n, t) => ipcRenderer.invoke('saveText', n, t),
});

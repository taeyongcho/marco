'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('vault', {
  exists: () => ipcRenderer.invoke('vault:exists'),
  create: (pw) => ipcRenderer.invoke('vault:create', pw),
  unlock: (pw) => ipcRenderer.invoke('vault:unlock', pw),
  lock: () => ipcRenderer.invoke('vault:lock'),
  save: (data) => ipcRenderer.invoke('vault:save', data),
  changePassword: (cur, next, data) => ipcRenderer.invoke('vault:changePassword', cur, next, data),
  exportCsv: (records) => ipcRenderer.invoke('vault:exportCsv', records),
  importCsv: () => ipcRenderer.invoke('vault:importCsv'),
  copy: (text, clearSeconds) => ipcRenderer.invoke('clipboard:copy', text, clearSeconds),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  filePath: () => ipcRenderer.invoke('vault:path'),
  onLockRequest: (cb) => ipcRenderer.on('vault:lock-request', () => cb()),
});

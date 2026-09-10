'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('vault', {
  info: () => ipcRenderer.invoke('vault:info'),
  exists: () => ipcRenderer.invoke('vault:exists'),
  create: (pw) => ipcRenderer.invoke('vault:create', pw),
  unlock: (pw) => ipcRenderer.invoke('vault:unlock', pw),
  lock: () => ipcRenderer.invoke('vault:lock'),
  save: (data) => ipcRenderer.invoke('vault:save', data),
  changePassword: (cur, next, data) => ipcRenderer.invoke('vault:changePassword', cur, next, data),
  moveTo: () => ipcRenderer.invoke('vault:moveTo'),
  moveToDefault: () => ipcRenderer.invoke('vault:moveToDefault'),
  openExisting: () => ipcRenderer.invoke('vault:openExisting'),
  useDefaultLocation: () => ipcRenderer.invoke('vault:useDefaultLocation'),
  showInFolder: () => ipcRenderer.invoke('vault:showInFolder'),
  exportCsv: (records) => ipcRenderer.invoke('vault:exportCsv', records),
  importCsv: () => ipcRenderer.invoke('vault:importCsv'),
  copy: (text, clearSeconds) => ipcRenderer.invoke('clipboard:copy', text, clearSeconds),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  notify: (title, body) => ipcRenderer.invoke('app:notify', title, body),
  setTheme: (mode) => ipcRenderer.invoke('theme:set', mode),
  onLockRequest: (cb) => ipcRenderer.on('vault:lock-request', () => cb()),
});

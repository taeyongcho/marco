'use strict';
const { app, BrowserWindow, ipcMain, clipboard, dialog, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const { Vault } = require('./vault');
const { toCsv, fromCsv } = require('./csv');

let win = null;
let vault = null;
let clipboardTimer = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 820,
    minHeight: 540,
    title: 'Marco Vault',
    backgroundColor: '#f4f5f7',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.on('closed', () => { win = null; });
  // 창을 최소화하면 잠금
  win.on('minimize', () => { if (win) win.webContents.send('vault:lock-request'); });
}

function ok(data) { return { ok: true, data }; }
function fail(e) { return { ok: false, error: e && e.message ? e.message : String(e) }; }

function registerIpc() {
  ipcMain.handle('vault:path', () => vault.filePath);
  ipcMain.handle('vault:exists', () => vault.exists());
  ipcMain.handle('vault:create', (_e, pw) => { try { return ok(vault.create(pw)); } catch (e) { return fail(e); } });
  ipcMain.handle('vault:unlock', (_e, pw) => { try { return ok(vault.unlock(pw)); } catch (e) { return fail(e); } });
  ipcMain.handle('vault:lock', () => { vault.lock(); clearClipboardNow(); return ok(true); });
  ipcMain.handle('vault:save', (_e, data) => { try { vault.save(data); return ok(true); } catch (e) { return fail(e); } });
  ipcMain.handle('vault:changePassword', (_e, cur, next, data) => {
    try { vault.changePassword(cur, next, data); return ok(true); } catch (e) { return fail(e); }
  });

  ipcMain.handle('clipboard:copy', (_e, text, clearSeconds) => {
    clipboard.writeText(String(text ?? ''));
    if (clipboardTimer) clearTimeout(clipboardTimer);
    const sec = Number(clearSeconds) || 0;
    if (sec > 0) {
      clipboardTimer = setTimeout(() => {
        // 그 사이 사용자가 다른 것을 복사했으면 건드리지 않음
        if (clipboard.readText() === String(text ?? '')) clipboard.clear();
        clipboardTimer = null;
      }, sec * 1000);
    }
    return ok(true);
  });

  ipcMain.handle('shell:openExternal', (_e, url) => {
    try {
      const u = new URL(url);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('http/https 주소만 열 수 있습니다.');
      shell.openExternal(u.toString());
      return ok(true);
    } catch (e) { return fail(e); }
  });

  ipcMain.handle('vault:exportCsv', async (_e, records) => {
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: 'CSV로 내보내기',
      defaultPath: 'marco-vault-export.csv',
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    });
    if (canceled || !filePath) return ok(false);
    try { fs.writeFileSync(filePath, toCsv(records), 'utf8'); return ok(true); } catch (e) { return fail(e); }
  });

  ipcMain.handle('vault:importCsv', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: 'CSV 가져오기',
      properties: ['openFile'],
      filters: [{ name: 'CSV', extensions: ['csv', 'txt'] }],
    });
    if (canceled || !filePaths.length) return ok(null);
    try { return ok(fromCsv(fs.readFileSync(filePaths[0], 'utf8'))); } catch (e) { return fail(e); }
  });
}

function clearClipboardNow() {
  if (clipboardTimer) { clearTimeout(clipboardTimer); clipboardTimer = null; }
}

app.whenReady().then(() => {
  vault = new Vault(path.join(app.getPath('userData'), 'vault.mv'));
  registerIpc();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => {
  if (vault) vault.lock();
  app.quit();
});

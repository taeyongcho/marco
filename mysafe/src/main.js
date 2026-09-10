'use strict';
const { app, BrowserWindow, ipcMain, clipboard, dialog, shell, Menu, Notification, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
const { Vault } = require('./vault');
const { toCsv, fromCsv } = require('./csv');

const APP_ID = 'kr.marco.mysafe';
let win = null;
let vault = null;
let clipboardTimer = null;
let configPath = null;

/* ---------- 설정 파일 (볼트 위치 등, 암호화 대상 아님) ---------- */
function defaultVaultPath() { return path.join(app.getPath('userData'), 'vault.mv'); }
function readConfig() {
  try { return JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch (_) { return {}; }
}
function writeConfig(cfg) {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2), 'utf8');
}
function currentVaultPath() {
  const cfg = readConfig();
  return cfg.vaultPath && typeof cfg.vaultPath === 'string' ? cfg.vaultPath : defaultVaultPath();
}
function vaultInfo() {
  const p = vault.filePath;
  const isDefault = p === defaultVaultPath();
  const exists = fs.existsSync(p);
  let dirOk = true;
  try { fs.accessSync(path.dirname(p)); } catch (_) { dirOk = false; }
  return { path: p, exists, isDefault, dirOk, defaultPath: defaultVaultPath() };
}

function createWindow() {
  win = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 900,
    minHeight: 560,
    title: 'MySafe',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0f172a' : '#f1f5f9',
    autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
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
  win.on('minimize', () => { if (win) win.webContents.send('vault:lock-request'); });
}

function ok(data) { return { ok: true, data }; }
function fail(e) { return { ok: false, error: e && e.message ? e.message : String(e) }; }

function registerIpc() {
  ipcMain.handle('vault:info', () => vaultInfo());
  ipcMain.handle('vault:exists', () => vault.exists());
  ipcMain.handle('vault:create', (_e, pw) => { try { return ok(vault.create(pw)); } catch (e) { return fail(e); } });
  ipcMain.handle('vault:unlock', (_e, pw) => { try { return ok(vault.unlock(pw)); } catch (e) { return fail(e); } });
  ipcMain.handle('vault:lock', () => { vault.lock(); clearClipboardNow(); return ok(true); });
  ipcMain.handle('vault:save', (_e, data) => { try { vault.save(data); return ok(true); } catch (e) { return fail(e); } });
  ipcMain.handle('vault:changePassword', (_e, cur, next, data) => {
    try { vault.changePassword(cur, next, data); return ok(true); } catch (e) { return fail(e); }
  });

  /* 볼트 파일 위치: 잠금 해제 상태에서 폴더를 골라 파일을 옮김 */
  ipcMain.handle('vault:moveTo', async () => {
    if (!vault.isUnlocked()) return fail(new Error('볼트가 잠겨 있습니다.'));
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: '볼트 파일을 보관할 폴더 선택', properties: ['openDirectory', 'createDirectory'],
    });
    if (canceled || !filePaths.length) return ok(null);
    const target = path.join(filePaths[0], 'vault.mv');
    if (target === vault.filePath) return ok(null);
    if (fs.existsSync(target)) return fail(new Error('선택한 폴더에 이미 vault.mv 파일이 있습니다.'));
    try {
      fs.copyFileSync(vault.filePath, target);
      fs.unlinkSync(vault.filePath);
      vault.filePath = target;
      writeConfig({ ...readConfig(), vaultPath: target === defaultVaultPath() ? undefined : target });
      return ok(vaultInfo());
    } catch (e) { return fail(e); }
  });
  ipcMain.handle('vault:moveToDefault', async () => {
    if (!vault.isUnlocked()) return fail(new Error('볼트가 잠겨 있습니다.'));
    const target = defaultVaultPath();
    if (target === vault.filePath) return ok(vaultInfo());
    if (fs.existsSync(target)) return fail(new Error('기본 위치에 이미 vault.mv 파일이 있습니다.'));
    try {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(vault.filePath, target);
      fs.unlinkSync(vault.filePath);
      vault.filePath = target;
      const cfg = readConfig(); delete cfg.vaultPath; writeConfig(cfg);
      return ok(vaultInfo());
    } catch (e) { return fail(e); }
  });
  /* 잠금 상태에서 기존 볼트 파일을 골라 연결 (USB, 클라우드 폴더 등) */
  ipcMain.handle('vault:openExisting', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: '기존 볼트 파일 열기', properties: ['openFile'],
      filters: [{ name: 'MySafe', extensions: ['mv'] }, { name: '모든 파일', extensions: ['*'] }],
    });
    if (canceled || !filePaths.length) return ok(null);
    vault.lock();
    vault = new Vault(filePaths[0]);
    writeConfig({ ...readConfig(), vaultPath: filePaths[0] === defaultVaultPath() ? undefined : filePaths[0] });
    return ok(vaultInfo());
  });
  ipcMain.handle('vault:useDefaultLocation', () => {
    vault.lock();
    vault = new Vault(defaultVaultPath());
    const cfg = readConfig(); delete cfg.vaultPath; writeConfig(cfg);
    return ok(vaultInfo());
  });
  ipcMain.handle('vault:showInFolder', () => { shell.showItemInFolder(vault.filePath); return ok(true); });

  ipcMain.handle('clipboard:copy', (_e, text, clearSeconds) => {
    clipboard.writeText(String(text ?? ''));
    if (clipboardTimer) clearTimeout(clipboardTimer);
    const sec = Number(clearSeconds) || 0;
    if (sec > 0) {
      clipboardTimer = setTimeout(() => {
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

  ipcMain.handle('app:notify', (_e, title, body) => {
    if (!Notification.isSupported()) return ok(false);
    const n = new Notification({ title: String(title), body: String(body), icon: path.join(__dirname, '..', 'build', 'icon.png') });
    n.on('click', () => { if (win) { win.show(); win.focus(); } });
    n.show();
    return ok(true);
  });

  ipcMain.handle('theme:set', (_e, mode) => { nativeTheme.themeSource = ['light', 'dark', 'system'].includes(mode) ? mode : 'system'; return ok(true); });

  ipcMain.handle('vault:exportCsv', async (_e, records) => {
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: 'CSV로 내보내기', defaultPath: 'mysafe-export.csv', filters: [{ name: 'CSV', extensions: ['csv'] }],
    });
    if (canceled || !filePath) return ok(false);
    try { fs.writeFileSync(filePath, toCsv(records), 'utf8'); return ok(true); } catch (e) { return fail(e); }
  });
  ipcMain.handle('vault:importCsv', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: 'CSV 가져오기', properties: ['openFile'], filters: [{ name: 'CSV', extensions: ['csv', 'txt'] }],
    });
    if (canceled || !filePaths.length) return ok(null);
    try { return ok(fromCsv(fs.readFileSync(filePaths[0], 'utf8'))); } catch (e) { return fail(e); }
  });
}

function clearClipboardNow() {
  if (clipboardTimer) { clearTimeout(clipboardTimer); clipboardTimer = null; }
}

/* 이전 이름(Marco Vault)으로 저장된 데이터 폴더가 있으면 새 폴더로 1회 이전 */
function migrateOldDataDir() {
  const newDir = app.getPath('userData');
  const oldDir = path.join(app.getPath('appData'), 'Marco Vault');
  if (oldDir === newDir || !fs.existsSync(oldDir)) return;
  for (const name of ['vault.mv', 'config.json']) {
    const src = path.join(oldDir, name), dst = path.join(newDir, name);
    if (fs.existsSync(src) && !fs.existsSync(dst)) {
      try { fs.mkdirSync(newDir, { recursive: true }); fs.copyFileSync(src, dst); } catch (_) { /* 무시 */ }
    }
  }
}

app.setAppUserModelId(APP_ID);
app.whenReady().then(() => {
  migrateOldDataDir();
  configPath = path.join(app.getPath('userData'), 'config.json');
  vault = new Vault(currentVaultPath());
  registerIpc();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => {
  if (vault) vault.lock();
  app.quit();
});

'use strict';
const { app, BrowserWindow, ipcMain, clipboard, dialog, shell, Menu, Notification, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
const { Vault } = require('./vault');
const { toCsv, fromCsv } = require('./csv');
const { verifyLicense } = require('./license');
const clock = require('./clock');

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
function backupsDir() { return path.join(app.getPath('userData'), 'backups'); }
function stamp() { return new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14); }
/** 위치를 옮길 때마다 이전 경로를 기억해 둔다 (파일을 잃어버렸을 때 되찾기 위해) */
function rememberPath(p) {
  const cfg = readConfig();
  const list = (cfg.previousPaths || []).filter(x => x !== p);
  list.unshift(p);
  writeConfig({ ...cfg, previousPaths: list.slice(0, 10) });
}
/** 되살릴 수 있는 볼트 파일을 모두 찾는다 (기본 위치, 이전 위치, 자동 백업, 옆에 둔 .bak) */
function listCandidates() {
  const seen = new Set(); const out = [];
  const add = (p, kind) => {
    try {
      if (!p || seen.has(p) || p === vault.filePath) return;
      const st = fs.statSync(p);
      if (!st.isFile() || st.size === 0) return;
      seen.add(p);
      out.push({ path: p, kind, size: st.size, mtime: st.mtime.toISOString() });
    } catch (_) { /* 없거나 읽을 수 없으면 건너뛴다 */ }
  };
  const cfg = readConfig();
  add(defaultVaultPath(), 'default');
  for (const p of (cfg.previousPaths || [])) add(p, 'previous');
  const dirs = new Set([path.dirname(vault.filePath), path.dirname(defaultVaultPath()),
    ...(cfg.previousPaths || []).map(p => path.dirname(p))]);
  for (const d of dirs) {
    try { for (const f of fs.readdirSync(d)) if (/^vault\.mv\..+\.bak$/.test(f)) add(path.join(d, f), 'backup'); } catch (_) { /* 폴더 없음 */ }
  }
  try { for (const f of fs.readdirSync(backupsDir())) if (f.endsWith('.mv')) add(path.join(backupsDir(), f), 'auto'); } catch (_) { /* 폴더 없음 */ }
  return out.sort((a, b) => b.mtime.localeCompare(a.mtime));
}
/** 하루 한 번, 볼트를 AppData 안 백업 폴더에도 복사해 둔다 (볼트를 둔 폴더가 통째로 사라져도 남도록) */
function autoBackup() {
  try {
    if (!fs.existsSync(vault.filePath)) return;
    const dir = backupsDir();
    fs.mkdirSync(dir, { recursive: true });
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const existing = fs.readdirSync(dir).filter(f => f.endsWith('.mv')).sort();
    if (existing.some(f => f.includes(today))) return;      // 오늘 것이 이미 있으면 건너뛴다
    fs.copyFileSync(vault.filePath, path.join(dir, `vault-${stamp()}.mv`));
    const all = fs.readdirSync(dir).filter(f => f.endsWith('.mv')).sort();
    for (const f of all.slice(0, Math.max(0, all.length - 10))) {   // 최근 10개만 남긴다
      try { fs.unlinkSync(path.join(dir, f)); } catch (_) { /* 무시 */ }
    }
  } catch (_) { /* 백업 실패가 사용을 막지는 않는다 */ }
}
/** 설치·업데이트 때 지워지는 폴더인지 (프로그램 폴더, 임시 폴더) */
function isUnsafeDir(dir) {
  const norm = d => path.resolve(d).toLowerCase().replace(/[\\/]+$/, '');
  const target = norm(dir);
  const risky = [path.dirname(app.getPath('exe')), app.getPath('temp')];
  return risky.some(r => { const n = norm(r); return target === n || target.startsWith(n + path.sep); });
}
function vaultInfo() {
  const p = vault.filePath;
  const isDefault = p === defaultVaultPath();
  const exists = fs.existsSync(p);
  let dirOk = true;
  try { fs.accessSync(path.dirname(p)); } catch (_) { dirOk = false; }
  return {
    path: p, exists, isDefault, dirOk, defaultPath: defaultVaultPath(),
    backupsDir: backupsDir(), candidates: exists ? [] : listCandidates(),
  };
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

/* ---------- 시스템 날짜 되돌림 감지 ---------- */
let vaultSeen;          // 볼트 안에 기록된 마지막 사용 시각 (잠금 해제 후에만 알 수 있음)
let clockState = null;

function runClockCheck() {
  const dir = app.getPath('userData');
  const cfg = readConfig();
  clockState = clock.checkClock({
    now: Date.now(), configRecord: cfg.clock, vaultSeen,
    stateSeen: clock.readState(dir, dir), tag: dir,
  });
  // 기록 갱신 (되돌림 상태에서도 "본 적 있는 가장 늦은 시각"은 유지된다)
  writeConfig({ ...cfg, clock: clockState.record });
  clock.writeState(dir, clockState.nextSeen, dir);
  return clockState;
}

function licenseInfo() {
  const c = runClockCheck();
  const today = clock.ymd(c.effectiveNow);
  const lic = readConfig().license;
  const base = c.ok ? {} : { clockIssue: c.reason, clockBackDays: Math.floor(c.backMs / 86400000), clockSeen: clock.ymd(c.seen) };
  if (!lic || !lic.user || !lic.key) return { licensed: false, ...base };
  const v = verifyLicense(lic.user, lic.key, today);
  if (!v.ok) return { licensed: false, error: v.error, ...base };
  return { licensed: true, user: v.user, type: v.type, typeLabel: v.typeLabel, expires: v.expires, expired: v.expired, daysLeft: v.daysLeft, ...base };
}

function registerIpc() {
  ipcMain.handle('license:get', () => licenseInfo());
  ipcMain.handle('license:set', (_e, user, key) => {
    const c = runClockCheck();
    const v = verifyLicense(user, key, clock.ymd(c.effectiveNow));
    if (!v.ok) return fail(new Error(v.error));
    if (v.expired) return fail(new Error(`만료된 ${v.typeLabel} 라이선스입니다. (만료일 ${v.expires})`));
    writeConfig({ ...readConfig(), license: { user: v.user, key: String(key).trim() } });
    return ok(licenseInfo());
  });
  ipcMain.handle('license:clear', () => { const cfg = readConfig(); delete cfg.license; writeConfig(cfg); return ok(licenseInfo()); });
  ipcMain.handle('app:version', () => app.getVersion());
  /** 구버전 볼트를 새 구성으로 올리기 전에 원본을 한 번 복사해 둔다 */
  ipcMain.handle('vault:backup', () => {
    try {
      if (!fs.existsSync(vault.filePath)) return ok(null);
      const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const target = `${vault.filePath}.${stamp}.bak`;
      if (!fs.existsSync(target)) fs.copyFileSync(vault.filePath, target);
      return ok(target);
    } catch (e) { return fail(e); }
  });
  ipcMain.handle('vault:info', () => vaultInfo());
  ipcMain.handle('vault:exists', () => vault.exists());
  ipcMain.handle('vault:create', (_e, pw) => { try { return ok(vault.create(pw)); } catch (e) { return fail(e); } });
  ipcMain.handle('vault:unlock', (_e, pw) => {
    try {
      const data = vault.unlock(pw);
      if (data && data.meta && typeof data.meta.lastSeen === 'number') vaultSeen = data.meta.lastSeen;
      const c = runClockCheck();
      if (!c.ok) { vault.lock(); return fail(new Error('시스템 날짜가 되돌려진 것으로 보입니다. 날짜를 올바르게 맞춘 뒤 다시 시도하세요.')); }
      autoBackup();
      return ok(data);
    } catch (e) { return fail(e); }
  });
  ipcMain.handle('vault:lock', () => { vault.lock(); clearClipboardNow(); runClockCheck(); return ok(true); });
  ipcMain.handle('vault:save', (_e, data) => {
    try {
      const c = runClockCheck();
      const withMeta = { ...data, meta: { ...(data.meta || {}), lastSeen: c.nextSeen } };
      vault.save(withMeta);
      vaultSeen = c.nextSeen;
      return ok(true);
    } catch (e) { return fail(e); }
  });
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
    const dir = filePaths[0];
    if (isUnsafeDir(dir)) {
      return fail(new Error('프로그램 설치 폴더나 임시 폴더에는 둘 수 없습니다. 프로그램을 업데이트하면 그 폴더의 파일이 지워져 데이터를 잃게 됩니다.'));
    }
    const target = path.join(dir, 'vault.mv');
    if (target === vault.filePath) return ok(null);
    if (fs.existsSync(target)) return fail(new Error('선택한 폴더에 이미 vault.mv 파일이 있습니다.'));
    try {
      const source = vault.filePath;
      fs.copyFileSync(source, target);
      // 원본을 지우지 않고 백업으로 남긴다. 옮긴 폴더가 사라져도 되찾을 수 있도록.
      const kept = `${source}.moved-${stamp()}.bak`;
      try { fs.renameSync(source, kept); } catch (_) { /* 이름을 못 바꾸면 원본을 그대로 둔다 */ }
      rememberPath(source);
      vault.filePath = target;
      writeConfig({ ...readConfig(), vaultPath: target === defaultVaultPath() ? undefined : target });
      autoBackup();
      return ok({ ...vaultInfo(), kept });
    } catch (e) { return fail(e); }
  });
  ipcMain.handle('vault:moveToDefault', async () => {
    if (!vault.isUnlocked()) return fail(new Error('볼트가 잠겨 있습니다.'));
    const target = defaultVaultPath();
    if (target === vault.filePath) return ok(vaultInfo());
    if (fs.existsSync(target)) return fail(new Error('기본 위치에 이미 vault.mv 파일이 있습니다.'));
    try {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      const source = vault.filePath;
      fs.copyFileSync(source, target);
      const kept = `${source}.moved-${stamp()}.bak`;
      try { fs.renameSync(source, kept); } catch (_) { /* 원본 유지 */ }
      rememberPath(source);
      vault.filePath = target;
      const cfg = readConfig(); delete cfg.vaultPath; writeConfig(cfg);
      autoBackup();
      return ok({ ...vaultInfo(), kept });
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
    rememberPath(vault.filePath);
    vault = new Vault(filePaths[0]);
    writeConfig({ ...readConfig(), vaultPath: filePaths[0] === defaultVaultPath() ? undefined : filePaths[0] });
    return ok(vaultInfo());
  });
  ipcMain.handle('vault:useDefaultLocation', () => {
    vault.lock();
    rememberPath(vault.filePath);
    vault = new Vault(defaultVaultPath());
    const cfg = readConfig(); delete cfg.vaultPath; writeConfig(cfg);
    return ok(vaultInfo());
  });
  ipcMain.handle('vault:candidates', () => listCandidates());
  /** 남아 있는 백업 파일을 지운다 (볼트를 다른 곳으로 옮긴 뒤 이 PC에 사본을 남기고 싶지 않을 때) */
  ipcMain.handle('vault:deleteBackup', (_e, p) => {
    try {
      if (p === vault.filePath) return fail(new Error('지금 쓰고 있는 볼트 파일은 지울 수 없습니다.'));
      const isBackup = p.endsWith('.bak') || path.dirname(p) === backupsDir();
      if (!isBackup) return fail(new Error('백업 파일만 지울 수 있습니다.'));
      fs.unlinkSync(p);
      return ok(true);
    } catch (e) { return fail(e); }
  });
  ipcMain.handle('vault:backupsDir', () => { try { fs.mkdirSync(backupsDir(), { recursive: true }); } catch (_) {} shell.openPath(backupsDir()); return ok(true); });
  /** 찾은 볼트 파일을 다시 쓰도록 연결한다. 백업 파일이면 기본 위치로 복사해서 쓴다. */
  ipcMain.handle('vault:useCandidate', (_e, p) => {
    try {
      if (!fs.existsSync(p)) return fail(new Error('파일을 찾을 수 없습니다.'));
      const isBackup = p.endsWith('.bak') || path.dirname(p) === backupsDir();
      vault.lock();
      rememberPath(vault.filePath);
      if (isBackup) {
        const target = defaultVaultPath();
        fs.mkdirSync(path.dirname(target), { recursive: true });
        if (fs.existsSync(target)) fs.renameSync(target, `${target}.replaced-${stamp()}.bak`);
        fs.copyFileSync(p, target);
        vault = new Vault(target);
        const cfg = readConfig(); delete cfg.vaultPath; writeConfig(cfg);
      } else {
        vault = new Vault(p);
        writeConfig({ ...readConfig(), vaultPath: p === defaultVaultPath() ? undefined : p });
      }
      return ok(vaultInfo());
    } catch (e) { return fail(e); }
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

  ipcMain.handle('app:setTitle', (_e, t) => { if (win) win.setTitle(String(t || 'MySafe')); return ok(true); });
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

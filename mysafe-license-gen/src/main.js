'use strict';
const { app, BrowserWindow, ipcMain, clipboard, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const { generateLicense } = require('./keygen');
const auth = require('./auth');

let win = null;
let unlocked = false;   // 비밀번호 확인 전에는 어떤 발급도 하지 않는다
let attempts = 0;

function settingsPath() { return path.join(app.getPath('userData'), 'gen-settings.json'); }
function readSettings() { try { return JSON.parse(fs.readFileSync(settingsPath(), 'utf8')); } catch (_) { return {}; } }
function writeSettings(s) { fs.mkdirSync(path.dirname(settingsPath()), { recursive: true }); fs.writeFileSync(settingsPath(), JSON.stringify(s, null, 2), 'utf8'); }
function passwordRecord() {
  const s = readSettings();
  if (s.password) return s.password;
  const rec = auth.makeRecord(auth.DEFAULT_PASSWORD);   // 최초 실행: 기본 비밀번호로 초기화
  writeSettings({ ...s, password: rec, isDefault: true });
  return rec;
}

function historyPath() { return path.join(app.getPath('userData'), 'history.json'); }
function readHistory() { try { return JSON.parse(fs.readFileSync(historyPath(), 'utf8')); } catch (_) { return []; } }
function writeHistory(h) { fs.mkdirSync(path.dirname(historyPath()), { recursive: true }); fs.writeFileSync(historyPath(), JSON.stringify(h, null, 2), 'utf8'); }

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  win = new BrowserWindow({
    width: 760, height: 640, minWidth: 640, minHeight: 520, title: 'MySafe License Generator', autoHideMenuBar: true,
    backgroundColor: '#0f172a', icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  ipcMain.handle('auth:state', () => ({ unlocked, isDefault: !!readSettings().isDefault }));
  ipcMain.handle('auth:unlock', (_e, password) => {
    if (attempts >= 5) return { ok: false, error: '비밀번호를 5회 틀렸습니다. 프로그램을 다시 실행하세요.', lockout: true };
    if (!auth.verify(password, passwordRecord())) {
      attempts++;
      return { ok: false, error: `비밀번호가 올바르지 않습니다. (${attempts}/5)` };
    }
    attempts = 0; unlocked = true;
    return { ok: true, isDefault: !!readSettings().isDefault };
  });
  ipcMain.handle('auth:lock', () => { unlocked = false; return true; });
  ipcMain.handle('auth:change', (_e, cur, next) => {
    if (!unlocked) return { ok: false, error: '먼저 로그인하세요.' };
    if (!auth.verify(cur, passwordRecord())) return { ok: false, error: '현재 비밀번호가 올바르지 않습니다.' };
    try {
      writeSettings({ ...readSettings(), password: auth.makeRecord(next), isDefault: false });
      return { ok: true };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  ipcMain.handle('gen', (_e, user, kind, expires, memo) => {
    if (!unlocked) return { ok: false, error: '먼저 로그인하세요.' };
    try {
      const r = generateLicense(user, kind, expires);
      const entry = {
        user: String(user).trim().replace(/\s+/g, ' '), type: r.type, typeLabel: r.typeLabel,
        expires: r.expires, memo: memo || '', key: r.key, issuedAt: new Date().toISOString(),
      };
      const h = readHistory(); h.unshift(entry); writeHistory(h.slice(0, 500));
      return { ok: true, data: entry };
    } catch (e) { return { ok: false, error: e.message }; }
  });
  ipcMain.handle('history', () => (unlocked ? readHistory() : []));
  ipcMain.handle('history:clear', () => { if (unlocked) writeHistory([]); return unlocked; });
  ipcMain.handle('copy', (_e, t) => { if (unlocked) clipboard.writeText(String(t)); return unlocked; });
  ipcMain.handle('saveText', async (_e, name, text) => {
    if (!unlocked) return false;
    const { canceled, filePath } = await dialog.showSaveDialog(win, { defaultPath: name, filters: [{ name: '텍스트', extensions: ['txt'] }] });
    if (canceled || !filePath) return false;
    fs.writeFileSync(filePath, text, 'utf8'); return true;
  });
});
app.on('window-all-closed', () => app.quit());

'use strict';
/* MySafe 렌더러 */

const FIELD_KINDS = { text: '일반', secret: '비밀', url: 'URL', date: '날짜', yearly: '기념일', select: '선택' };
const DEFAULT_SETTINGS = { autoLockMinutes: 5, clipboardClearSeconds: 30, notifyDays: 30, notify: true };

function defaultMenus() {
  return [
    { id: 'login', label: '시스템로그인', icon: 'key', fields: [
      { key: 'username', label: 'ID', kind: 'text' }, { key: 'password', label: 'Pass', kind: 'secret' },
      { key: 'url', label: 'URL', kind: 'url' }, { key: 'ip', label: 'IP', kind: 'text' },
    ]},
    { id: 'bank', label: '뱅킹', icon: 'bank', fields: [
      { key: 'bank', label: '은행명', kind: 'text' }, { key: 'accountNumber', label: '계좌번호', kind: 'text' },
      { key: 'username', label: 'ID', kind: 'text' }, { key: 'password', label: 'Pass', kind: 'secret' }, { key: 'url', label: 'URL', kind: 'url' },
    ]},
    { id: 'card', label: '크레디트카드', icon: 'card', fields: [
      { key: 'cardName', label: '카드명', kind: 'text' }, { key: 'cardNumber', label: '카드번호', kind: 'secret' },
      { key: 'expiry', label: '만료일', kind: 'text' }, { key: 'pin', label: 'PIN', kind: 'secret' }, { key: 'cardPassword', label: 'Pass (카드)', kind: 'secret' },
      { key: 'billingAccount', label: '결제계좌', kind: 'text' }, { key: 'url', label: 'URL', kind: 'url' },
      { key: 'username', label: 'ID', kind: 'text' }, { key: 'password', label: 'Pass (로그인)', kind: 'secret' },
    ]},
    { id: 'insurance', label: '보험', icon: 'shield', fields: [
      { key: 'company', label: '보험사', kind: 'text' }, { key: 'product', label: '보험상품', kind: 'text' }, { key: 'url', label: 'URL', kind: 'url' },
      { key: 'expiry', label: '만기일', kind: 'date' }, { key: 'premium', label: '보험료', kind: 'text' }, { key: 'insured', label: '피보험자', kind: 'text' },
    ]},
    { id: 'anniversary', label: '기념일', icon: 'cake', fields: [
      { key: 'kind', label: '구분', kind: 'select', options: ['생일', '결혼기념일', '기일', '기타'] },
      { key: 'name', label: '이름', kind: 'text' }, { key: 'relation', label: '관계', kind: 'text' },
      { key: 'date', label: '날짜', kind: 'yearly' }, { key: 'calendar', label: '양/음', kind: 'select', options: ['양력', '음력'] },
    ]},
  ];
}

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

const state = {
  data: null, view: { kind: 'view', value: 'all' }, selectedId: null, editing: false, query: '',
  sort: 'title', viewMode: 'compact', lockTimer: null, genTarget: null, info: null,
};

/* ---------- 로컬(PC별) UI 환경설정 ---------- */
const prefs = {
  get(k, d) { try { const v = localStorage.getItem('mv.' + k); return v === null ? d : JSON.parse(v); } catch (_) { return d; } },
  set(k, v) { try { localStorage.setItem('mv.' + k, JSON.stringify(v)); } catch (_) { /* 무시 */ } },
};
function applyAppearance() {
  const theme = prefs.get('theme', 'system');
  const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.documentElement.style.fontSize = prefs.get('font', 14) + 'px';
  window.vault.setTheme(theme);
}
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyAppearance);

/* ---------- 유틸 ---------- */
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function fmtDate(iso) { if (!iso) return ''; return new Date(iso).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' }); }
function fmtDay(ymd) { const d = parseYmd(ymd); return d ? `${d.getMonth() + 1}월 ${d.getDate()}일` : ''; }
function parseYmd(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '').trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return isNaN(d) ? null : d;
}
function today0() { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }
/** D-day 계산. yearly면 올해/내년 중 다음 도래일 기준. 반환: { days, next, years } 또는 null */
function ddayOf(value, kind) {
  const d = parseYmd(value); if (!d) return null;
  const t = today0();
  if (kind === 'yearly') {
    let next = new Date(t.getFullYear(), d.getMonth(), d.getDate());
    if (next < t) next = new Date(t.getFullYear() + 1, d.getMonth(), d.getDate());
    return { days: Math.round((next - t) / 86400000), next, years: next.getFullYear() - d.getFullYear() };
  }
  return { days: Math.round((d - t) / 86400000), next: d, years: 0 };
}
function ddayLabel(dd) { return dd.days === 0 ? 'D-day' : dd.days > 0 ? `D-${dd.days}` : `D+${-dd.days}`; }
function ddayClass(dd) { return dd.days < 0 ? 'past' : dd.days === 0 ? 'today' : dd.days <= 7 ? 'soon' : ''; }
/** 레코드의 날짜 필드 중 가장 가까운 것 */
function nearestDday(r) {
  let best = null;
  for (const f of fieldsOf(r.type)) {
    if (f.kind !== 'date' && f.kind !== 'yearly') continue;
    const dd = ddayOf(r.fields?.[f.key], f.kind); if (!dd) continue;
    if (f.kind === 'date' && dd.days < 0) continue; // 지난 만기일은 알림 대상 제외
    if (!best || dd.days < best.days) best = { ...dd, field: f };
  }
  return best;
}
function upcomingRecords() {
  const n = Number(state.data.settings.notifyDays) || 30;
  return state.data.records.map(r => ({ r, dd: nearestDday(r) })).filter(x => x.dd && x.dd.days >= 0 && x.dd.days <= n)
    .sort((a, b) => a.dd.days - b.dd.days);
}

function toast(msg, type = 'ok', ms = 2800) {
  const box = $('#toasts');
  for (const old of box.children) if (old.textContent === msg) old.remove();
  while (box.children.length >= 3) box.firstChild.remove();
  const el = document.createElement('div'); el.className = 'toast ' + type; el.textContent = msg;
  box.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; setTimeout(() => el.remove(), 300); }, ms);
}
async function copyText(text, label = '복사') {
  await window.vault.copy(text, state.data.settings.clipboardClearSeconds);
  const sec = state.data.settings.clipboardClearSeconds;
  toast(`${label}했습니다.` + (sec > 0 ? ` ${sec}초 후 클립보드에서 지워집니다.` : ''), 'info');
}
function passwordStrength(pw) {
  let s = 0; if (!pw) return 0;
  if (pw.length >= 8) s++; if (pw.length >= 12) s++; if (pw.length >= 16) s++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++; if (/\d/.test(pw)) s++; if (/[^A-Za-z0-9]/.test(pw)) s++;
  return Math.min(s, 6);
}
function paintStrength(el, pw) {
  const s = passwordStrength(pw);
  el.style.width = (s / 6 * 100) + '%';
  el.style.background = s <= 2 ? 'var(--danger)' : s <= 4 ? '#f59e0b' : '#16a34a';
}
function menus() { return state.data.menus; }
function menuOf(id) { return menus().find(m => m.id === id) || null; }
function fieldsOf(id) { const m = menuOf(id); return m ? m.fields : []; }
function isSecret(type, key) { const f = fieldsOf(type).find(x => x.key === key); return !!(f && f.kind === 'secret'); }

/* ---------- 저장 ---------- */
async function persist() {
  const r = await window.vault.save(state.data);
  if (!r.ok) { toast('저장 실패: ' + r.error, 'err', 6000); return false; }
  return true;
}

/* ---------- 인증 화면 ---------- */
async function showAuth() {
  $('#screen-main').hidden = true;
  $('#screen-auth').hidden = false;
  $('#auth-error').hidden = true;
  const info = await window.vault.info(); state.info = info;
  $('#auth-path').textContent = '볼트 파일: ' + info.path;
  const missing = !info.exists && !info.isDefault;   // 지정한 위치(USB 등)에 파일이 없음
  $('#form-setup').hidden = info.exists || missing;
  $('#form-unlock').hidden = !info.exists;
  $('#auth-missing').hidden = !missing;
  $('#auth-subtitle').textContent = info.exists ? '마스터 비밀번호를 입력해 잠금을 해제하세요.'
    : missing ? '지정된 위치에서 볼트 파일을 찾지 못했습니다.' : '처음 사용합니다. 마스터 비밀번호를 만들어 주세요.';
  const input = info.exists ? $('#unlock-pw') : $('#setup-pw');
  input.value = ''; setTimeout(() => input.focus(), 50);
}
function authError(msg) { const el = $('#auth-error'); el.textContent = msg; el.hidden = false; }

$('#setup-pw').addEventListener('input', e => paintStrength($('#setup-strength'), e.target.value));
$$('button[data-eye-for]').forEach(b => b.addEventListener('click', () => { const i = $('#' + b.dataset.eyeFor); i.type = i.type === 'password' ? 'text' : 'password'; }));

$('#form-setup').addEventListener('submit', async e => {
  e.preventDefault();
  const pw = $('#setup-pw').value, pw2 = $('#setup-pw2').value;
  if (pw !== pw2) return authError('비밀번호 확인이 일치하지 않습니다.');
  const r = await window.vault.create(pw);
  if (!r.ok) return authError(r.error);
  enterMain(r.data);
});
$('#form-unlock').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = e.target.querySelector('button[type=submit]'); btn.disabled = true; btn.textContent = '확인 중…';
  const r = await window.vault.unlock($('#unlock-pw').value);
  btn.disabled = false; btn.textContent = '잠금 해제';
  if (!r.ok) { $('#unlock-pw').value = ''; $('#unlock-pw').focus(); return authError(r.error); }
  enterMain(r.data);
});
async function openExisting() {
  const r = await window.vault.openExisting();
  if (!r.ok) return authError(r.error);
  if (r.data) showAuth();
}
$('#btn-open-existing').addEventListener('click', openExisting);
$('#btn-open-existing2').addEventListener('click', openExisting);
$('#btn-use-default').addEventListener('click', async () => { await window.vault.useDefaultLocation(); showAuth(); });

/* ---------- 메인 ---------- */
function migrate(data) {
  data.records ||= []; data.categories ||= [];
  if (!Array.isArray(data.menus) || !data.menus.length) data.menus = defaultMenus();
  for (const m of data.menus) {
    if (EMOJI_TO_ICON[m.icon]) m.icon = EMOJI_TO_ICON[m.icon];
    if (!ICON_PATHS[m.icon]) m.icon = 'folder';
    for (const f of m.fields) if (m.id === 'anniversary' && f.key === 'date' && f.kind === 'date') f.kind = 'yearly';
  }
  data.settings = Object.assign({}, DEFAULT_SETTINGS, data.settings || {});
}
function enterMain(data) {
  migrate(data);
  state.data = data;
  state.selectedId = null; state.editing = false; state.query = '';
  state.view = { kind: 'view', value: 'all' };
  state.sort = prefs.get('sort', 'title'); state.viewMode = prefs.get('viewMode', 'compact');
  $('#sort').value = state.sort; $('#search').value = '';
  $('#screen-auth').hidden = true; $('#screen-main').hidden = false;
  $('#form-unlock').reset(); $('#form-setup').reset();
  renderAll();
  resetLockTimer();
  notifyUpcoming();
}
async function lock() {
  if (!state.data) return;
  if (state.editing && !confirm('편집 중인 내용이 저장되지 않았습니다. 잠글까요?')) return;
  await window.vault.lock();
  state.data = null; state.selectedId = null; state.editing = false;
  clearTimeout(state.lockTimer);
  $$('dialog[open]').forEach(d => d.close());
  showAuth();
}
function resetLockTimer() {
  clearTimeout(state.lockTimer);
  if (!state.data) return;
  const min = Number(state.data.settings.autoLockMinutes) || 0;
  if (min > 0) state.lockTimer = setTimeout(lock, min * 60 * 1000);
}
['mousemove', 'keydown', 'mousedown', 'wheel'].forEach(ev => document.addEventListener(ev, () => { if (state.data) resetLockTimer(); }, { passive: true }));
window.vault.onLockRequest(() => lock());

function notifyUpcoming() {
  const up = upcomingRecords();
  if (!up.length) return;
  const soon = up.filter(x => x.dd.days <= 7);
  const msg = up.slice(0, 3).map(x => `${x.r.title} ${ddayLabel(x.dd)}`).join(', ') + (up.length > 3 ? ` 외 ${up.length - 3}건` : '');
  toast(`다가오는 일정 ${up.length}건: ${msg}`, 'info', 6000);
  if (state.data.settings.notify && soon.length) {
    const key = today0().toISOString().slice(0, 10);
    if (prefs.get('notifiedOn') !== key) {
      prefs.set('notifiedOn', key);
      window.vault.notify('MySafe · 다가오는 일정', soon.slice(0, 4).map(x => `${x.r.title} ${ddayLabel(x.dd)} (${fmtDay(x.dd.next.toISOString().slice(0, 10))})`).join('\n'));
    }
  }
}

function renderAll() { renderSidebar(); renderList(); renderDetail(); }

/* 사이드바 */
function renderSidebar() {
  const recs = state.data.records;
  const typeCounts = {}, catCounts = {};
  for (const r of recs) { typeCounts[r.type] = (typeCounts[r.type] || 0) + 1; if (r.category) catCounts[r.category] = (catCounts[r.category] || 0) + 1; }
  $('#count-all').textContent = recs.length || '';
  $('#count-fav').textContent = recs.filter(r => r.favorite).length || '';
  $('#count-upcoming').textContent = upcomingRecords().length || '';
  $('#nav-types').innerHTML = menus().map(m =>
    `<li data-type="${m.id}"><span>${ico(m.icon)} ${esc(m.label)}</span><span class="count">${typeCounts[m.id] || ''}</span></li>`).join('');
  $('#nav-categories').innerHTML = state.data.categories.map(c =>
    `<li data-category="${esc(c)}" title="우클릭: 삭제"><span>${ico('folder')} ${esc(c)}</span><span class="count">${catCounts[c] || ''}</span></li>`).join('')
    + `<li data-category=""><span>${ico('folderOpen')} 미분류</span><span class="count">${recs.filter(r => !r.category).length || ''}</span></li>`;
  $$('.sidebar .nav li').forEach(li => {
    const v = state.view;
    li.classList.toggle('active',
      (li.dataset.view !== undefined && v.kind === 'view' && v.value === li.dataset.view)
      || (li.dataset.type !== undefined && v.kind === 'type' && v.value === li.dataset.type)
      || (li.dataset.category !== undefined && v.kind === 'category' && v.value === li.dataset.category));
  });
}
$('#nav-views').addEventListener('click', e => { const li = e.target.closest('li'); if (li) setView('view', li.dataset.view, li.querySelector('span').textContent); });
$('#nav-types').addEventListener('click', e => { const li = e.target.closest('li'); if (li) setView('type', li.dataset.type, menuOf(li.dataset.type)?.label || ''); });
$('#nav-categories').addEventListener('click', e => { const li = e.target.closest('li'); if (li) setView('category', li.dataset.category, li.dataset.category || '미분류'); });
$('#nav-categories').addEventListener('contextmenu', async e => {
  const li = e.target.closest('li'); if (!li || !li.dataset.category) return;
  const c = li.dataset.category;
  if (!confirm(`카테고리 "${c}"를 삭제할까요? 해당 항목은 미분류가 됩니다.`)) return;
  state.data.categories = state.data.categories.filter(x => x !== c);
  state.data.records.forEach(r => { if (r.category === c) r.category = ''; });
  if (state.view.kind === 'category' && state.view.value === c) state.view = { kind: 'view', value: 'all' };
  if (await persist()) renderAll();
});
function setView(kind, value, title) {
  state.view = { kind, value };
  $('#list-title').textContent = title.trim();
  if (kind === 'view' && value === 'upcoming' && state.sort !== 'dday') { $('#sort').value = 'dday'; state.sort = 'dday'; }
  renderSidebar(); renderList();
}

/* 목록 */
function filteredRecords() {
  const q = state.query.trim().toLowerCase();
  const v = state.view;
  let recs;
  if (v.kind === 'view' && v.value === 'upcoming') recs = upcomingRecords().map(x => x.r);
  else recs = state.data.records.filter(r => {
    if (v.kind === 'type') return r.type === v.value;
    if (v.kind === 'category') return (r.category || '') === v.value;
    if (v.value === 'favorites') return !!r.favorite;
    return true;
  });
  if (q) recs = recs.filter(r => {
    const hay = [r.title, r.category, r.notes, menuOf(r.type)?.label,
      ...Object.entries(r.fields || {}).filter(([k]) => !isSecret(r.type, k)).map(([, x]) => x)].join('\n').toLowerCase();
    return hay.includes(q);
  });
  const byTitle = (a, b) => a.title.localeCompare(b.title, 'ko');
  const sort = (v.kind === 'view' && v.value === 'recent') ? 'updated' : state.sort;
  const dd = r => { const x = nearestDday(r); return x ? x.days : Infinity; };
  recs = recs.slice();
  if (sort === 'updated') recs.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  else if (sort === 'created') recs.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  else if (sort === 'fav') recs.sort((a, b) => (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0) || byTitle(a, b));
  else if (sort === 'dday') recs.sort((a, b) => dd(a) - dd(b) || byTitle(a, b));
  else recs.sort(byTitle);
  return recs;
}
function subtitleOf(r) {
  const f = r.fields || {};
  const first = fieldsOf(r.type).find(x => x.kind !== 'secret' && x.kind !== 'date' && x.kind !== 'yearly' && f[x.key]);
  return (first ? f[first.key] : '') || menuOf(r.type)?.label || '';
}
function ddayChip(r) {
  const dd = nearestDday(r); if (!dd) return '';
  const n = Number(state.data.settings.notifyDays) || 30;
  if (dd.days > n && state.viewMode === 'compact') return '';
  return `<span class="chip dday ${ddayClass(dd)}" title="${esc(dd.field.label)} ${esc(r.fields[dd.field.key])}">${ddayLabel(dd)}</span>`;
}
function renderList() {
  const recs = filteredRecords();
  $('#list-count').textContent = recs.length ? recs.length + '개' : '';
  $('#list-empty').hidden = recs.length > 0;
  const detail = state.viewMode === 'detail';
  $('#btn-viewmode').innerHTML = ico(detail ? 'listDetail' : 'list');
  $('#records').innerHTML = recs.map(r => `
    <li data-id="${r.id}" class="${r.id === state.selectedId ? 'active' : ''}">
      <span class="ico">${ico(menuOf(r.type)?.icon || 'note')}</span>
      <span class="meta"><div class="t">${esc(r.title)}</div><div class="s">${esc(subtitleOf(r))}</div>
        ${detail ? `<div class="extra"><span class="chip">${esc(menuOf(r.type)?.label || '')}</span>${r.category ? `<span class="chip">${ico('folder')} ${esc(r.category)}</span>` : ''}<span class="chip">${esc(fmtDate(r.updatedAt).replace(/ \S+ \S+$/, ''))}</span></div>` : ''}
      </span>
      <span class="right">${r.favorite ? `<span class="fav">${ico('star', 'fill')}</span>` : ''}${ddayChip(r)}</span>
    </li>`).join('');
}
$('#records').addEventListener('click', e => {
  const li = e.target.closest('li'); if (!li) return;
  if (state.editing && !confirm('편집 중인 내용을 버릴까요?')) return;
  state.editing = false; state.selectedId = li.dataset.id; renderList(); renderDetail();
});
$('#search').addEventListener('input', e => { state.query = e.target.value; renderList(); });
$('#sort').addEventListener('change', e => { state.sort = e.target.value; prefs.set('sort', state.sort); renderList(); });
$('#btn-viewmode').addEventListener('click', () => { state.viewMode = state.viewMode === 'compact' ? 'detail' : 'compact'; prefs.set('viewMode', state.viewMode); renderList(); });

/* 상세 보기 */
function current() { return state.data.records.find(r => r.id === state.selectedId) || null; }
function renderDetail() {
  const r = current();
  $('#detail-empty').hidden = !!r || state.editing;
  $('#detail-form').hidden = !state.editing;
  $('#detail-view').hidden = !r || state.editing;
  if (state.editing) return renderForm();
  if (!r) return;
  const t = menuOf(r.type) || { label: '(삭제된 주메뉴)', icon: 'note', fields: [] };
  const rows = t.fields.filter(f => r.fields && r.fields[f.key]).map(f => {
    const val = r.fields[f.key];
    let v;
    if (f.kind === 'secret') v = `<span class="v secret" data-secret="${esc(val)}" data-shown="0">••••••••••</span>`;
    else if (f.kind === 'url') v = `<span class="v"><a href="#" data-open="${esc(val)}">${esc(val)}</a></span>`;
    else if (f.kind === 'date' || f.kind === 'yearly') {
      const dd = ddayOf(val, f.kind);
      v = `<span class="v plain">${esc(val)} ${dd ? `<span class="chip dday ${ddayClass(dd)}">${ddayLabel(dd)}${f.kind === 'yearly' && dd.years > 0 ? ` · ${dd.years}회째` : ''}</span>` : ''}</span>`;
    }
    else v = `<span class="v ${f.kind === 'text' ? '' : 'plain'}">${esc(val)}</span>`;
    return `<div class="field"><span class="k">${esc(f.label)}</span>${v}
      <span class="btns">${f.kind === 'secret' ? `<button class="icon" data-toggle title="보기/숨기기">${ico('eye')}</button>` : ''}<button class="icon" data-copy="${esc(val)}" title="복사">${ico('copy')}</button></span></div>`;
  }).join('');
  $('#detail-view').innerHTML = `
    <div class="card detail-head">
      <span class="ico">${ico(t.icon)}</span>
      <div><h2>${esc(r.title)}</h2>
        <div class="sub"><span class="chip">${esc(t.label)}</span><span class="chip">${ico('folder')} ${esc(r.category || '미분류')}</span><span>수정 ${fmtDate(r.updatedAt)}</span></div></div>
      <div class="actions">
        <button data-act="fav" class="${r.favorite ? 'fav-on' : ''}" title="즐겨찾기">${ico('star', r.favorite ? 'fill' : '')}</button>
        <button data-act="edit">${ico('edit')} 편집</button>
        <button data-act="delete" class="danger">${ico('trash')} 삭제</button>
      </div>
    </div>
    ${rows ? `<div class="card">${rows}</div>` : (t.fields.length ? '<div class="card muted">입력된 항목이 없습니다.</div>' : '')}
    ${r.notes ? `<div class="card"><h4>Memo</h4><div class="notes-v">${esc(r.notes)}</div></div>` : ''}`;
}
$('#detail-view').addEventListener('click', async e => {
  const r = current(); if (!r) return;
  const btn = e.target.closest('button, a'); if (!btn) return;
  e.preventDefault();
  if (btn.dataset.open) return window.vault.openExternal(btn.dataset.open);
  if (btn.dataset.copy !== undefined) return copyText(btn.dataset.copy);
  if (btn.hasAttribute('data-toggle')) {
    const span = btn.closest('.field').querySelector('.v.secret');
    const shown = span.dataset.shown === '1';
    span.textContent = shown ? '••••••••••' : span.dataset.secret; span.dataset.shown = shown ? '0' : '1';
    return;
  }
  switch (btn.dataset.act) {
    case 'fav': r.favorite = !r.favorite; if (await persist()) { renderSidebar(); renderList(); renderDetail(); } break;
    case 'edit': state.editing = true; renderDetail(); break;
    case 'delete':
      if (!confirm(`"${r.title}" 항목을 삭제할까요?`)) return;
      state.data.records = state.data.records.filter(x => x.id !== r.id);
      state.selectedId = null;
      if (await persist()) { renderAll(); toast('삭제했습니다.'); }
      break;
  }
});

/* 편집 폼 */
function renderForm() {
  const defaultType = state.view.kind === 'type' && menuOf(state.view.value) ? state.view.value : menus()[0].id;
  const r = current() || { id: null, type: defaultType, title: '', category: '', notes: '', fields: {} };
  if (!menuOf(r.type)) r.type = menus()[0].id;
  const form = $('#detail-form');
  const typeOpts = menus().map(m => `<option value="${m.id}" ${m.id === r.type ? 'selected' : ''}>${esc(m.label)}</option>`).join('');
  const catOpts = ['<option value="">미분류</option>', ...state.data.categories.map(c => `<option value="${esc(c)}" ${c === r.category ? 'selected' : ''}>${esc(c)}</option>`)].join('');
  form.innerHTML = `
    <div class="card">
      <h2>${r.id ? '항목 편집' : '새 항목'}</h2>
      <div class="form-row">
        <label>주메뉴 <select name="type">${typeOpts}</select></label>
        <label>카테고리 <select name="category">${catOpts}</select></label>
      </div>
      <label>제목 <input type="text" name="title" required value="${esc(r.title)}" placeholder="예: 회사 그룹웨어, 국민은행"></label>
      <div id="type-fields"></div>
      <label>Memo <textarea name="notes">${esc(r.notes || '')}</textarea></label>
      <div class="form-actions">
        <button type="submit" class="primary">저장</button>
        <button type="button" data-cancel>취소</button>
        <span class="spacer"></span>
        <span class="muted tiny">Ctrl+S 저장 · Esc 취소</span>
      </div>
    </div>`;
  const drawFields = (type, values) => {
    $('#type-fields').innerHTML = fieldsOf(type).map(f => {
      const raw = values[f.key] || ''; const v = esc(raw); const label = esc(f.label);
      if (f.kind === 'secret') return `<label>${label}<div class="pw-wrap"><input type="password" name="f_${f.key}" value="${v}" autocomplete="new-password">
        <button type="button" class="icon" data-eye title="보기/숨기기">${ico('eye')}</button><button type="button" class="icon" data-gen title="생성기">${ico('dice')}</button></div></label>`;
      if (f.kind === 'select') {
        const opts = (f.options || []).map(o => `<option value="${esc(o)}" ${o === raw ? 'selected' : ''}>${esc(o)}</option>`).join('');
        return `<label>${label}<select name="f_${f.key}"><option value="">선택</option>${opts}</select></label>`;
      }
      if (f.kind === 'date' || f.kind === 'yearly') return `<label>${label}${f.kind === 'yearly' ? ' <span class="muted">(매년 반복)</span>' : ''}<input type="date" name="f_${f.key}" value="${v}"></label>`;
      return `<label>${label}<input type="${f.kind === 'url' ? 'url' : 'text'}" name="f_${f.key}" value="${v}" ${f.kind === 'url' ? 'placeholder="https://"' : ''}></label>`;
    }).join('');
  };
  drawFields(r.type, r.fields || {});
  form.querySelector('[name=type]').addEventListener('change', e => drawFields(e.target.value, collectFields(form)));
  setTimeout(() => form.querySelector('[name=title]').focus(), 30);
}
function collectFields(form) {
  const out = {};
  for (const el of form.querySelectorAll('[name^="f_"]')) { const v = el.value.trim(); if (v) out[el.name.slice(2)] = v; }
  return out;
}
$('#detail-form').addEventListener('click', e => {
  const btn = e.target.closest('button'); if (!btn) return;
  if (btn.hasAttribute('data-cancel')) cancelEdit();
  else if (btn.hasAttribute('data-eye')) { const i = btn.parentElement.querySelector('input'); i.type = i.type === 'password' ? 'text' : 'password'; }
  else if (btn.hasAttribute('data-gen')) openGenerator(btn.parentElement.querySelector('input'));
});
function cancelEdit() { state.editing = false; if (state.selectedId && !current()) state.selectedId = null; renderDetail(); }
$('#detail-form').addEventListener('submit', async e => {
  e.preventDefault();
  const form = e.target, r = current(), now = new Date().toISOString();
  const rec = {
    id: r ? r.id : uid(), type: form.type.value, title: form.title.value.trim(), category: form.category.value,
    notes: form.notes.value, fields: collectFields(form), favorite: r ? !!r.favorite : false, createdAt: r ? r.createdAt : now, updatedAt: now,
  };
  if (!rec.title) return;
  if (r) Object.assign(r, rec); else state.data.records.push(rec);
  state.selectedId = rec.id; state.editing = false;
  if (await persist()) { renderAll(); toast('저장했습니다.'); }
});
function newRecord() {
  if (state.editing && !confirm('편집 중인 내용을 버릴까요?')) return;
  state.selectedId = null; state.editing = true; renderList(); renderDetail();
}
$('#btn-new').addEventListener('click', newRecord);
$('#btn-lock').addEventListener('click', lock);

/* 카테고리 */
$('#btn-add-category').addEventListener('click', () => { $('#cat-name').value = ''; $('#dlg-category').showModal(); });
$('#cat-cancel').addEventListener('click', () => $('#dlg-category').close());
$('#form-category').addEventListener('submit', async e => {
  const name = $('#cat-name').value.trim();
  if (!name) return e.preventDefault();
  if (!state.data.categories.includes(name)) { state.data.categories.push(name); await persist(); }
  renderSidebar(); if (state.editing) renderForm();
});

/* 비밀번호 생성기 */
function genBuild() {
  const len = Number($('#gen-length').value);
  const U = 'ABCDEFGHJKLMNPQRSTUVWXYZ', L = 'abcdefghijkmnopqrstuvwxyz', D = '23456789', S = '!@#$%^&*()-_=+[]{};:,.?';
  const noAmb = $('#gen-noambig').checked; let pool = '';
  if ($('#gen-upper').checked) pool += noAmb ? U : U + 'IO';
  if ($('#gen-lower').checked) pool += noAmb ? L : L + 'l';
  if ($('#gen-digit').checked) pool += noAmb ? D : D + '01';
  if ($('#gen-symbol').checked) pool += S;
  if (!pool) pool = L;
  const buf = new Uint32Array(len); crypto.getRandomValues(buf);
  let out = ''; for (let i = 0; i < len; i++) out += pool[buf[i] % pool.length];
  $('#gen-result').textContent = out; paintStrength($('#gen-strength'), out);
  return out;
}
function openGenerator(targetInput) {
  state.genTarget = targetInput || null; $('#gen-use').hidden = !targetInput;
  genBuild(); $('#dlg-generator').showModal();
}
$('#btn-generator').addEventListener('click', () => openGenerator(null));
$('#gen-refresh').addEventListener('click', genBuild);
$('#gen-length').addEventListener('input', e => { $('#gen-length-val').textContent = e.target.value; genBuild(); });
$$('#dlg-generator input[type=checkbox]').forEach(c => c.addEventListener('change', genBuild));
$('#gen-copy').addEventListener('click', () => copyText($('#gen-result').textContent, '비밀번호를 복사'));
$('#gen-use').addEventListener('click', () => {
  if (state.genTarget) { state.genTarget.value = $('#gen-result').textContent; state.genTarget.type = 'text'; }
  $('#dlg-generator').close();
});

/* 설정 */
async function refreshPathBox() {
  const info = await window.vault.info(); state.info = info;
  $('#set-path').textContent = info.path + (info.isDefault ? '  (기본 위치)' : '');
  $('#btn-move-default').hidden = info.isDefault;
}
$('#btn-settings').addEventListener('click', async () => {
  const s = state.data.settings;
  $('#set-autolock').value = s.autoLockMinutes; $('#set-clipclear').value = s.clipboardClearSeconds;
  $('#set-notifydays').value = s.notifyDays; $('#set-notify').checked = !!s.notify;
  $('#set-theme').value = prefs.get('theme', 'system'); $('#set-font').value = String(prefs.get('font', 14)); $('#set-viewmode').value = state.viewMode;
  ['#set-cur-pw', '#set-new-pw', '#set-new-pw2'].forEach(id => $(id).value = ''); $('#set-pw-msg').textContent = '';
  await refreshPathBox();
  $('#dlg-settings').showModal();
});
$('.settings-nav').addEventListener('click', e => {
  const b = e.target.closest('button[data-tab]'); if (!b) return;
  $$('.settings-nav button').forEach(x => x.classList.toggle('active', x === b));
  $$('.settings-body section').forEach(s => s.hidden = s.dataset.tab !== b.dataset.tab);
});
async function saveGeneralSettings() {
  const s = state.data.settings;
  s.autoLockMinutes = Math.max(0, Number($('#set-autolock').value) || 0);
  s.clipboardClearSeconds = Math.max(0, Number($('#set-clipclear').value) || 0);
  s.notifyDays = Math.min(365, Math.max(1, Number($('#set-notifydays').value) || 30));
  s.notify = $('#set-notify').checked;
  if (await persist()) { resetLockTimer(); renderSidebar(); renderList(); }
}
['#set-autolock', '#set-clipclear', '#set-notifydays', '#set-notify'].forEach(id => $(id).addEventListener('change', saveGeneralSettings));
$('#set-theme').addEventListener('change', e => { prefs.set('theme', e.target.value); applyAppearance(); });
$('#set-font').addEventListener('change', e => { prefs.set('font', Number(e.target.value)); applyAppearance(); });
$('#set-viewmode').addEventListener('change', e => { state.viewMode = e.target.value; prefs.set('viewMode', state.viewMode); renderList(); });
$('#settings-close').addEventListener('click', () => $('#dlg-settings').close());
$('#btn-change-pw').addEventListener('click', async () => {
  const msg = $('#set-pw-msg');
  const cur = $('#set-cur-pw').value, n1 = $('#set-new-pw').value, n2 = $('#set-new-pw2').value;
  if (n1 !== n2) { msg.textContent = '새 비밀번호 확인이 일치하지 않습니다.'; msg.className = 'tiny error'; return; }
  const r = await window.vault.changePassword(cur, n1, state.data);
  msg.textContent = r.ok ? '마스터 비밀번호를 변경했습니다.' : r.error; msg.className = r.ok ? 'tiny' : 'tiny error';
  if (r.ok) ['#set-cur-pw', '#set-new-pw', '#set-new-pw2'].forEach(id => $(id).value = '');
});
$('#btn-move-vault').addEventListener('click', async () => {
  const r = await window.vault.moveTo();
  if (!r.ok) return toast(r.error, 'err', 5000);
  if (r.data) { await refreshPathBox(); toast('볼트 파일을 옮겼습니다.'); }
});
$('#btn-move-default').addEventListener('click', async () => {
  const r = await window.vault.moveToDefault();
  if (!r.ok) return toast(r.error, 'err', 5000);
  await refreshPathBox(); toast('기본 위치로 되돌렸습니다.');
});
$('#btn-show-folder').addEventListener('click', () => window.vault.showInFolder());
$('#btn-export').addEventListener('click', async () => {
  const r = await window.vault.exportCsv(state.data.records);
  if (!r.ok) toast('내보내기 실패: ' + r.error, 'err'); else if (r.data) toast('CSV로 내보냈습니다.');
});
$('#btn-import').addEventListener('click', async () => {
  const r = await window.vault.importCsv();
  if (!r.ok) return toast('가져오기 실패: ' + r.error, 'err');
  if (!r.data) return;
  const now = new Date().toISOString(); let n = 0;
  for (const row of r.data) {
    if (!menuOf(row.type)) row.type = (menus().find(m => m.label === row.type) || menus()[0]).id;
    if (row.category && !state.data.categories.includes(row.category)) state.data.categories.push(row.category);
    state.data.records.push({ id: uid(), favorite: false, createdAt: now, updatedAt: now, ...row }); n++;
  }
  if (await persist()) { renderAll(); toast(`${n}개 항목을 가져왔습니다.`); }
});

/* 주메뉴 편집 (Edit) */
const me = { sel: null };
function openMenuEditor() {
  me.sel = menus()[0]?.id || null;
  $('#me-icon-grid').innerHTML = MENU_ICONS.map(i => `<button type="button" data-icon="${i}" title="${i}">${ico(i)}</button>`).join('');
  $('#me-icon-grid').hidden = true;
  renderMenuEditor(); $('#dlg-menus').showModal();
}
function renderMenuEditor() {
  const m = menuOf(me.sel);
  $('#me-menus').innerHTML = menus().map(x => `<li data-id="${x.id}" class="${x.id === me.sel ? 'active' : ''}"><span>${ico(x.icon)} ${esc(x.label)}</span></li>`).join('');
  $('.me-right').hidden = !m; if (!m) return;
  $('#me-icon-btn').innerHTML = ico(m.icon); $('#me-label').value = m.label;
  $$('#me-icon-grid button').forEach(b => b.classList.toggle('active', b.dataset.icon === m.icon));
  const idx = menus().indexOf(m); $('#me-up').disabled = idx === 0; $('#me-down').disabled = idx === menus().length - 1;
  const kindOpts = k => Object.entries(FIELD_KINDS).map(([v, l]) => `<option value="${v}" ${v === k ? 'selected' : ''}>${l}</option>`).join('');
  $('#me-fields tbody').innerHTML = m.fields.map((f, i) => `
    <tr data-i="${i}">
      <td><input type="text" data-f="label" value="${esc(f.label)}" maxlength="20"></td>
      <td><select data-f="kind">${kindOpts(f.kind)}</select></td>
      <td><input type="text" data-f="options" value="${esc((f.options || []).join(', '))}" ${f.kind === 'select' ? '' : 'disabled'} placeholder="예: 양력, 음력"></td>
      <td><button type="button" class="icon" data-up title="위로">${ico('chevronUp')}</button><button type="button" class="icon" data-down title="아래로">${ico('chevronDown')}</button><button type="button" class="icon danger" data-del title="삭제">${ico('x')}</button></td>
    </tr>`).join('');
}
async function menusChanged() { await persist(); renderSidebar(); renderList(); if (state.editing) renderForm(); else renderDetail(); }
$('#btn-edit-menus').addEventListener('click', openMenuEditor);
$('#me-close').addEventListener('click', () => $('#dlg-menus').close());
$('#me-menus').addEventListener('click', e => { const li = e.target.closest('li'); if (li) { me.sel = li.dataset.id; renderMenuEditor(); } });
$('#me-add-menu').addEventListener('click', async () => {
  const m = { id: 'm_' + uid(), label: '새 주메뉴', icon: 'folder', fields: [{ key: 'f_' + uid(), label: '항목 1', kind: 'text' }] };
  menus().push(m); me.sel = m.id; renderMenuEditor(); await menusChanged();
  $('#me-label').focus(); $('#me-label').select();
});
$('#me-del-menu').addEventListener('click', async () => {
  const m = menuOf(me.sel); if (!m) return;
  const n = state.data.records.filter(r => r.type === m.id).length;
  if (n > 0) return alert(`이 주메뉴에 항목이 ${n}개 있어 삭제할 수 없습니다. 항목을 먼저 삭제하거나 다른 주메뉴로 옮기세요.`);
  if (menus().length <= 1) return alert('주메뉴는 최소 1개 있어야 합니다.');
  if (!confirm(`주메뉴 "${m.label}"를 삭제할까요?`)) return;
  state.data.menus = menus().filter(x => x.id !== m.id);
  if (state.view.kind === 'type' && state.view.value === m.id) state.view = { kind: 'view', value: 'all' };
  me.sel = menus()[0].id; renderMenuEditor(); await menusChanged();
});
async function moveMenu(delta) {
  const arr = menus(); const i = arr.findIndex(x => x.id === me.sel); const j = i + delta;
  if (i < 0 || j < 0 || j >= arr.length) return;
  [arr[i], arr[j]] = [arr[j], arr[i]]; renderMenuEditor(); await menusChanged();
}
$('#me-up').addEventListener('click', () => moveMenu(-1));
$('#me-down').addEventListener('click', () => moveMenu(1));
$('#me-label').addEventListener('change', async e => { const m = menuOf(me.sel); if (!m) return; m.label = e.target.value.trim() || m.label; renderMenuEditor(); await menusChanged(); });
$('#me-icon-btn').addEventListener('click', () => { $('#me-icon-grid').hidden = !$('#me-icon-grid').hidden; });
$('#me-icon-grid').addEventListener('click', async e => {
  const b = e.target.closest('button[data-icon]'); const m = menuOf(me.sel); if (!b || !m) return;
  m.icon = b.dataset.icon; $('#me-icon-grid').hidden = true; renderMenuEditor(); await menusChanged();
});
$('#me-add-field').addEventListener('click', async () => {
  const m = menuOf(me.sel); if (!m) return;
  m.fields.push({ key: 'f_' + uid(), label: '새 항목', kind: 'text' });
  renderMenuEditor(); await menusChanged();
  const inputs = $$('#me-fields input[data-f=label]'); const last = inputs[inputs.length - 1]; if (last) { last.focus(); last.select(); }
});
$('#me-fields').addEventListener('change', async e => {
  const m = menuOf(me.sel); const tr = e.target.closest('tr'); if (!m || !tr) return;
  const f = m.fields[Number(tr.dataset.i)]; if (!f) return;
  const what = e.target.dataset.f;
  if (what === 'label') f.label = e.target.value.trim() || f.label;
  else if (what === 'kind') { f.kind = e.target.value; if (f.kind === 'select' && !f.options) f.options = []; }
  else if (what === 'options') f.options = e.target.value.split(',').map(x => x.trim()).filter(Boolean);
  renderMenuEditor(); await menusChanged();
});
$('#me-fields').addEventListener('click', async e => {
  const btn = e.target.closest('button'); const tr = e.target.closest('tr'); const m = menuOf(me.sel);
  if (!btn || !tr || !m) return;
  const i = Number(tr.dataset.i);
  if (btn.hasAttribute('data-del')) {
    const used = state.data.records.filter(r => r.type === m.id && r.fields && r.fields[m.fields[i].key]).length;
    if (!confirm(`항목 "${m.fields[i].label}"을(를) 삭제할까요?` + (used ? ` 이미 값이 입력된 레코드가 ${used}개 있습니다. 값은 화면에서 보이지 않게 됩니다.` : ''))) return;
    m.fields.splice(i, 1);
  } else if (btn.hasAttribute('data-up') && i > 0) [m.fields[i - 1], m.fields[i]] = [m.fields[i], m.fields[i - 1]];
  else if (btn.hasAttribute('data-down') && i < m.fields.length - 1) [m.fields[i + 1], m.fields[i]] = [m.fields[i], m.fields[i + 1]];
  else return;
  renderMenuEditor(); await menusChanged();
});

/* 단축키 */
document.addEventListener('keydown', e => {
  if (!state.data) return;
  const ctrl = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
  if (ctrl && k === 'f') { e.preventDefault(); $('#search').focus(); $('#search').select(); }
  else if (ctrl && k === 'n') { e.preventDefault(); newRecord(); }
  else if (ctrl && k === 'l') { e.preventDefault(); lock(); }
  else if (ctrl && k === 's' && state.editing) { e.preventDefault(); $('#detail-form').requestSubmit(); }
  else if (e.key === 'Escape' && state.editing && !$$('dialog[open]').length) cancelEdit();
});

/* 시작 */
hydrateIcons();
applyAppearance();
showAuth();

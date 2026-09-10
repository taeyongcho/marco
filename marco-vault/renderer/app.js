'use strict';
/* Marco Vault 렌더러: 화면 상태 관리 및 UI */

const TYPES = {
  login:      { label: '웹 로그인', icon: '🌐', fields: [
    { key: 'url', label: '사이트 주소', kind: 'url' },
    { key: 'username', label: '아이디' },
    { key: 'password', label: '비밀번호', secret: true },
  ]},
  bank:       { label: '은행 계좌', icon: '🏦', fields: [
    { key: 'bank', label: '은행' },
    { key: 'accountNumber', label: '계좌번호' },
    { key: 'holder', label: '예금주' },
    { key: 'password', label: '비밀번호', secret: true },
    { key: 'pin', label: 'PIN', secret: true },
  ]},
  card:       { label: '신용카드', icon: '💳', fields: [
    { key: 'cardNumber', label: '카드번호', secret: true },
    { key: 'holder', label: '이름' },
    { key: 'expiry', label: '유효기간' },
    { key: 'cvv', label: 'CVV', secret: true },
    { key: 'pin', label: '비밀번호', secret: true },
  ]},
  membership: { label: '멤버십', icon: '🎫', fields: [
    { key: 'organization', label: '기관/업체' },
    { key: 'memberId', label: '회원번호' },
    { key: 'password', label: '비밀번호', secret: true },
    { key: 'phone', label: '연락처' },
  ]},
  identity:   { label: '신분증/문서', icon: '🪪', fields: [
    { key: 'idNumber', label: '번호', secret: true },
    { key: 'name', label: '이름' },
    { key: 'issueDate', label: '발급일' },
    { key: 'expiry', label: '만료일' },
  ]},
  wifi:       { label: 'Wi-Fi', icon: '📶', fields: [
    { key: 'ssid', label: '네트워크 이름' },
    { key: 'password', label: '비밀번호', secret: true },
  ]},
  server:     { label: '서버/DB', icon: '🖥', fields: [
    { key: 'host', label: '호스트' },
    { key: 'port', label: '포트' },
    { key: 'username', label: '계정' },
    { key: 'password', label: '비밀번호', secret: true },
  ]},
  note:       { label: '보안 메모', icon: '📝', fields: [] },
};

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

const state = {
  data: null,          // { records, categories, settings }
  view: { kind: 'view', value: 'all' },
  selectedId: null,
  editing: false,
  query: '',
  lockTimer: null,
  genTarget: null,     // 생성기 결과를 넣을 input
};

/* ---------- 유틸 ---------- */
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function fmtDate(iso) { if (!iso) return ''; const d = new Date(iso); return d.toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' }); }
function status(msg, ms = 2500) {
  const el = $('#status-msg'); el.textContent = msg;
  clearTimeout(status._t); status._t = setTimeout(() => { el.textContent = ''; }, ms);
}
async function copyText(text, label = '복사') {
  await window.vault.copy(text, state.data.settings.clipboardClearSeconds);
  const sec = state.data.settings.clipboardClearSeconds;
  status(`${label}했습니다.` + (sec > 0 ? ` (${sec}초 후 클립보드 자동 삭제)` : ''));
}
function passwordStrength(pw) {
  let score = 0;
  if (!pw) return 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (pw.length >= 16) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  return Math.min(score, 6);
}

/* ---------- 저장 ---------- */
async function persist() {
  const r = await window.vault.save(state.data);
  if (!r.ok) { alert('저장 실패: ' + r.error); return false; }
  return true;
}

/* ---------- 인증 화면 ---------- */
async function showAuth() {
  $('#screen-main').hidden = true;
  $('#screen-auth').hidden = false;
  $('#auth-error').hidden = true;
  $('#auth-path').textContent = '볼트 파일: ' + await window.vault.filePath();
  const exists = await window.vault.exists();
  $('#form-setup').hidden = exists;
  $('#form-unlock').hidden = !exists;
  $('#auth-subtitle').textContent = exists ? '마스터 비밀번호를 입력해 잠금을 해제하세요.' : '처음 사용합니다. 마스터 비밀번호를 만들어 주세요.';
  const input = exists ? $('#unlock-pw') : $('#setup-pw');
  input.value = ''; setTimeout(() => input.focus(), 50);
}

function authError(msg) { const el = $('#auth-error'); el.textContent = msg; el.hidden = false; }

$('#setup-pw').addEventListener('input', (e) => {
  const s = passwordStrength(e.target.value);
  const bar = $('#setup-strength');
  bar.style.width = (s / 6 * 100) + '%';
  bar.style.background = s <= 2 ? 'var(--danger)' : s <= 4 ? '#f59e0b' : '#16a34a';
});

$('#form-setup').addEventListener('submit', async (e) => {
  e.preventDefault();
  const pw = $('#setup-pw').value, pw2 = $('#setup-pw2').value;
  if (pw !== pw2) return authError('비밀번호 확인이 일치하지 않습니다.');
  const r = await window.vault.create(pw);
  if (!r.ok) return authError(r.error);
  enterMain(r.data);
});

$('#form-unlock').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector('button'); btn.disabled = true; btn.textContent = '확인 중…';
  const r = await window.vault.unlock($('#unlock-pw').value);
  btn.disabled = false; btn.textContent = '잠금 해제';
  if (!r.ok) { $('#unlock-pw').value = ''; $('#unlock-pw').focus(); return authError(r.error); }
  enterMain(r.data);
});

/* ---------- 메인 화면 ---------- */
function enterMain(data) {
  state.data = data;
  state.data.records ||= [];
  state.data.categories ||= [];
  state.data.settings = Object.assign({ autoLockMinutes: 5, clipboardClearSeconds: 30 }, data.settings || {});
  state.selectedId = null; state.editing = false; state.query = '';
  $('#search').value = '';
  $('#screen-auth').hidden = true;
  $('#screen-main').hidden = false;
  $('#form-unlock').reset(); $('#form-setup').reset();
  renderAll();
  resetLockTimer();
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
  $('#status-lock').textContent = min > 0 ? `자동 잠금: ${min}분 미사용 시` : '자동 잠금 꺼짐';
  if (min > 0) state.lockTimer = setTimeout(lock, min * 60 * 1000);
}
['mousemove', 'keydown', 'mousedown', 'wheel'].forEach(ev => document.addEventListener(ev, () => { if (state.data) resetLockTimer(); }, { passive: true }));
window.vault.onLockRequest(() => lock());

function renderAll() { renderSidebar(); renderList(); renderDetail(); }

/* 사이드바 */
function renderSidebar() {
  const recs = state.data.records;
  const typeCounts = {}; const catCounts = {};
  for (const r of recs) { typeCounts[r.type] = (typeCounts[r.type] || 0) + 1; if (r.category) catCounts[r.category] = (catCounts[r.category] || 0) + 1; }

  $('#nav-types').innerHTML = Object.entries(TYPES).map(([k, t]) =>
    `<li data-type="${k}"><span>${t.icon} ${t.label}</span><span class="count">${typeCounts[k] || ''}</span></li>`).join('');
  $('#nav-categories').innerHTML = state.data.categories.map(c =>
    `<li data-category="${esc(c)}" title="우클릭: 삭제"><span>📁 ${esc(c)}</span><span class="count">${catCounts[c] || ''}</span></li>`).join('')
    + `<li data-category=""><span>📂 미분류</span><span class="count">${recs.filter(r => !r.category).length || ''}</span></li>`;

  $$('.nav li').forEach(li => {
    const v = state.view;
    const active = (li.dataset.view !== undefined && v.kind === 'view' && v.value === li.dataset.view)
      || (li.dataset.type !== undefined && v.kind === 'type' && v.value === li.dataset.type)
      || (li.dataset.category !== undefined && v.kind === 'category' && v.value === li.dataset.category);
    li.classList.toggle('active', active);
  });
}

$('#nav-views').addEventListener('click', e => { const li = e.target.closest('li'); if (li) setView('view', li.dataset.view, li.textContent); });
$('#nav-types').addEventListener('click', e => { const li = e.target.closest('li'); if (li) setView('type', li.dataset.type, TYPES[li.dataset.type].label); });
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
  $('#list-title').textContent = title;
  renderSidebar(); renderList();
}

/* 목록 */
function filteredRecords() {
  const q = state.query.trim().toLowerCase();
  const v = state.view;
  let recs = state.data.records.filter(r => {
    if (v.kind === 'type') return r.type === v.value;
    if (v.kind === 'category') return (r.category || '') === v.value;
    if (v.value === 'favorites') return !!r.favorite;
    return true;
  });
  if (q) {
    recs = recs.filter(r => {
      const hay = [r.title, r.category, r.notes, ...Object.entries(r.fields || {}).filter(([k]) => !isSecret(r.type, k)).map(([, v]) => v)].join('\n').toLowerCase();
      return hay.includes(q);
    });
  }
  if (v.kind === 'view' && v.value === 'recent') recs.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  else recs.sort((a, b) => a.title.localeCompare(b.title, 'ko'));
  return recs;
}
function isSecret(type, key) { const f = (TYPES[type] || TYPES.note).fields.find(x => x.key === key); return !!(f && f.secret); }
function subtitleOf(r) {
  const f = r.fields || {};
  return f.username || f.url || f.accountNumber || f.organization || f.ssid || f.host || f.name || r.category || TYPES[r.type]?.label || '';
}

function renderList() {
  const recs = filteredRecords();
  $('#list-count').textContent = recs.length + '개';
  $('#list-empty').hidden = recs.length > 0;
  $('#records').innerHTML = recs.map(r => `
    <li data-id="${r.id}" class="${r.id === state.selectedId ? 'active' : ''}">
      <span class="ico">${TYPES[r.type]?.icon || '📄'}</span>
      <span class="meta"><div class="t">${esc(r.title)}</div><div class="s">${esc(subtitleOf(r))}</div></span>
      ${r.favorite ? '<span class="fav">★</span>' : ''}
    </li>`).join('');
}
$('#records').addEventListener('click', e => {
  const li = e.target.closest('li'); if (!li) return;
  if (state.editing && !confirm('편집 중인 내용을 버릴까요?')) return;
  state.editing = false; state.selectedId = li.dataset.id; renderList(); renderDetail();
});
$('#search').addEventListener('input', e => { state.query = e.target.value; renderList(); });

/* 상세 보기 */
function current() { return state.data.records.find(r => r.id === state.selectedId) || null; }

function renderDetail() {
  const r = current();
  $('#detail-empty').hidden = !!r || state.editing;
  $('#detail-form').hidden = !state.editing;
  $('#detail-view').hidden = !r || state.editing;
  if (state.editing) return renderForm();
  if (!r) return;
  const t = TYPES[r.type] || TYPES.note;
  const rows = t.fields.filter(f => r.fields && r.fields[f.key]).map(f => {
    const val = r.fields[f.key];
    let v;
    if (f.secret) v = `<span class="v secret" data-secret="${esc(val)}" data-shown="0">••••••••••</span>`;
    else if (f.kind === 'url') v = `<span class="v"><a href="#" data-open="${esc(val)}">${esc(val)}</a></span>`;
    else v = `<span class="v">${esc(val)}</span>`;
    return `<div class="field"><span class="k">${f.label}</span>${v}
      <span class="btns">${f.secret ? '<button class="icon" data-toggle title="보기/숨기기">👁</button>' : ''}<button class="icon" data-copy="${esc(val)}" title="복사">📋</button></span></div>`;
  }).join('');
  $('#detail-view').innerHTML = `
    <div class="detail-head">
      <span class="ico">${t.icon}</span>
      <div><h2>${esc(r.title)}</h2><div class="sub">${t.label} · ${esc(r.category || '미분류')} · 수정 ${fmtDate(r.updatedAt)}</div></div>
      <div class="actions">
        <button data-act="fav" title="즐겨찾기">${r.favorite ? '★' : '☆'}</button>
        <button data-act="edit">✎ 편집</button>
        <button data-act="delete" class="danger">삭제</button>
      </div>
    </div>
    ${rows || (t.fields.length ? '<p class="muted">입력된 필드가 없습니다.</p>' : '')}
    ${r.notes ? `<div class="notes"><label>메모</label><div class="v">${esc(r.notes)}</div></div>` : ''}`;
}

$('#detail-view').addEventListener('click', async e => {
  const r = current(); if (!r) return;
  const btn = e.target.closest('button, a'); if (!btn) return;
  e.preventDefault();
  if (btn.dataset.open) { window.vault.openExternal(btn.dataset.open); return; }
  if (btn.dataset.copy !== undefined) { copyText(btn.dataset.copy); return; }
  if (btn.hasAttribute('data-toggle')) {
    const span = btn.closest('.field').querySelector('.v.secret');
    const shown = span.dataset.shown === '1';
    span.textContent = shown ? '••••••••••' : span.dataset.secret; span.dataset.shown = shown ? '0' : '1';
    return;
  }
  switch (btn.dataset.act) {
    case 'fav': r.favorite = !r.favorite; if (await persist()) { renderList(); renderDetail(); } break;
    case 'edit': state.editing = true; renderDetail(); break;
    case 'delete':
      if (!confirm(`"${r.title}" 항목을 삭제할까요?`)) return;
      state.data.records = state.data.records.filter(x => x.id !== r.id);
      state.selectedId = null;
      if (await persist()) { renderAll(); status('삭제했습니다.'); }
      break;
  }
});

/* 편집 폼 */
function renderForm() {
  const r = current() || { id: null, type: 'login', title: '', category: '', notes: '', fields: {} };
  const form = $('#detail-form');
  const typeOpts = Object.entries(TYPES).map(([k, t]) => `<option value="${k}" ${k === r.type ? 'selected' : ''}>${t.icon} ${t.label}</option>`).join('');
  const catOpts = ['<option value="">미분류</option>', ...state.data.categories.map(c => `<option value="${esc(c)}" ${c === r.category ? 'selected' : ''}>${esc(c)}</option>`)].join('');
  form.innerHTML = `
    <h2 style="margin-top:0">${r.id ? '항목 편집' : '새 항목'}</h2>
    <div class="form-row">
      <label>종류 <select name="type">${typeOpts}</select></label>
      <label>카테고리 <select name="category">${catOpts}</select></label>
    </div>
    <label>제목 <input type="text" name="title" required value="${esc(r.title)}" placeholder="예: 네이버, 국민은행"></label>
    <div id="type-fields"></div>
    <label>메모 <textarea name="notes">${esc(r.notes || '')}</textarea></label>
    <div class="form-actions">
      <button type="submit" class="primary">저장</button>
      <button type="button" data-cancel>취소</button>
      <span class="spacer"></span>
      <span class="muted tiny" style="align-self:center">Ctrl+S 저장 · Esc 취소</span>
    </div>`;
  const drawFields = (type, values) => {
    $('#type-fields').innerHTML = TYPES[type].fields.map(f => {
      const v = esc(values[f.key] || '');
      if (f.secret) return `<label>${f.label}<div class="pw-wrap"><input type="password" name="f_${f.key}" value="${v}" autocomplete="new-password">
        <button type="button" class="icon" data-eye title="보기/숨기기">👁</button><button type="button" class="icon" data-gen title="생성기">🎲</button></div></label>`;
      return `<label>${f.label}<input type="${f.kind === 'url' ? 'url' : 'text'}" name="f_${f.key}" value="${v}" ${f.kind === 'url' ? 'placeholder="https://"' : ''}></label>`;
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
  if (btn.hasAttribute('data-cancel')) { cancelEdit(); }
  else if (btn.hasAttribute('data-eye')) { const i = btn.parentElement.querySelector('input'); i.type = i.type === 'password' ? 'text' : 'password'; }
  else if (btn.hasAttribute('data-gen')) { openGenerator(btn.parentElement.querySelector('input')); }
});
function cancelEdit() {
  state.editing = false;
  if (state.selectedId && !current()) state.selectedId = null;
  renderDetail();
}
$('#detail-form').addEventListener('submit', async e => {
  e.preventDefault();
  const form = e.target;
  const r = current();
  const now = new Date().toISOString();
  const rec = {
    id: r ? r.id : uid(),
    type: form.type.value,
    title: form.title.value.trim(),
    category: form.category.value,
    notes: form.notes.value,
    fields: collectFields(form),
    favorite: r ? !!r.favorite : false,
    createdAt: r ? r.createdAt : now,
    updatedAt: now,
  };
  if (!rec.title) return;
  if (r) Object.assign(r, rec); else state.data.records.push(rec);
  state.selectedId = rec.id; state.editing = false;
  if (await persist()) { renderAll(); status('저장했습니다.'); }
});

function newRecord() {
  if (state.editing && !confirm('편집 중인 내용을 버릴까요?')) return;
  state.selectedId = null; state.editing = true; renderList(); renderDetail();
}
$('#btn-new').addEventListener('click', newRecord);
$('#btn-lock').addEventListener('click', lock);

/* 카테고리 추가 */
$('#btn-add-category').addEventListener('click', () => { $('#cat-name').value = ''; $('#dlg-category').showModal(); });
$('#cat-cancel').addEventListener('click', () => $('#dlg-category').close());
$('#form-category').addEventListener('submit', async e => {
  const name = $('#cat-name').value.trim();
  if (!name) return e.preventDefault();
  if (!state.data.categories.includes(name)) { state.data.categories.push(name); await persist(); }
  renderSidebar();
  if (state.editing) renderForm();
});

/* 비밀번호 생성기 */
const gen = {
  build() {
    const len = Number($('#gen-length').value);
    let pool = '';
    const U = 'ABCDEFGHJKLMNPQRSTUVWXYZ', L = 'abcdefghijkmnopqrstuvwxyz', D = '23456789', S = '!@#$%^&*()-_=+[]{};:,.?';
    const noAmb = $('#gen-noambig').checked;
    if ($('#gen-upper').checked) pool += noAmb ? U : U + 'IO';
    if ($('#gen-lower').checked) pool += noAmb ? L : L + 'l';
    if ($('#gen-digit').checked) pool += noAmb ? D : D + '01';
    if ($('#gen-symbol').checked) pool += S;
    if (!pool) pool = L;
    const buf = new Uint32Array(len); crypto.getRandomValues(buf);
    let out = '';
    for (let i = 0; i < len; i++) out += pool[buf[i] % pool.length];
    $('#gen-result').textContent = out;
    return out;
  },
};
function openGenerator(targetInput) {
  state.genTarget = targetInput || null;
  $('#gen-use').hidden = !targetInput;
  gen.build();
  $('#dlg-generator').showModal();
}
$('#btn-generator').addEventListener('click', () => openGenerator(null));
$('#gen-refresh').addEventListener('click', gen.build);
$('#gen-length').addEventListener('input', e => { $('#gen-length-val').textContent = e.target.value; gen.build(); });
$$('#dlg-generator input[type=checkbox]').forEach(c => c.addEventListener('change', gen.build));
$('#gen-copy').addEventListener('click', () => copyText($('#gen-result').textContent, '비밀번호를 복사'));
$('#gen-use').addEventListener('click', () => {
  if (state.genTarget) { state.genTarget.value = $('#gen-result').textContent; state.genTarget.type = 'text'; }
  $('#dlg-generator').close();
});

/* 설정 */
$('#btn-settings').addEventListener('click', async () => {
  const s = state.data.settings;
  $('#set-autolock').value = s.autoLockMinutes;
  $('#set-clipclear').value = s.clipboardClearSeconds;
  ['#set-cur-pw', '#set-new-pw', '#set-new-pw2'].forEach(id => $(id).value = '');
  $('#set-pw-msg').textContent = '';
  $('#set-path').textContent = '볼트 파일: ' + await window.vault.filePath();
  $('#dlg-settings').showModal();
});
$('#form-settings').addEventListener('submit', async () => {
  state.data.settings.autoLockMinutes = Math.max(0, Number($('#set-autolock').value) || 0);
  state.data.settings.clipboardClearSeconds = Math.max(0, Number($('#set-clipclear').value) || 0);
  if (await persist()) { resetLockTimer(); status('설정을 저장했습니다.'); }
});
$('#btn-change-pw').addEventListener('click', async () => {
  const msg = $('#set-pw-msg');
  const cur = $('#set-cur-pw').value, n1 = $('#set-new-pw').value, n2 = $('#set-new-pw2').value;
  if (n1 !== n2) { msg.textContent = '새 비밀번호 확인이 일치하지 않습니다.'; msg.className = 'tiny error'; return; }
  const r = await window.vault.changePassword(cur, n1, state.data);
  msg.textContent = r.ok ? '마스터 비밀번호를 변경했습니다.' : r.error;
  msg.className = r.ok ? 'tiny' : 'tiny error';
  if (r.ok) ['#set-cur-pw', '#set-new-pw', '#set-new-pw2'].forEach(id => $(id).value = '');
});
$('#btn-export').addEventListener('click', async () => {
  const r = await window.vault.exportCsv(state.data.records);
  if (!r.ok) alert('내보내기 실패: ' + r.error); else if (r.data) status('CSV로 내보냈습니다.');
});
$('#btn-import').addEventListener('click', async () => {
  const r = await window.vault.importCsv();
  if (!r.ok) return alert('가져오기 실패: ' + r.error);
  if (!r.data) return;
  const now = new Date().toISOString();
  let n = 0;
  for (const row of r.data) {
    if (!TYPES[row.type]) row.type = 'login';
    if (row.category && !state.data.categories.includes(row.category)) state.data.categories.push(row.category);
    state.data.records.push({ id: uid(), favorite: false, createdAt: now, updatedAt: now, ...row });
    n++;
  }
  if (await persist()) { renderAll(); status(`${n}개 항목을 가져왔습니다.`); }
});

/* 단축키 */
document.addEventListener('keydown', e => {
  if (!state.data) return;
  const ctrl = e.ctrlKey || e.metaKey;
  if (ctrl && e.key.toLowerCase() === 'f') { e.preventDefault(); $('#search').focus(); $('#search').select(); }
  else if (ctrl && e.key.toLowerCase() === 'n') { e.preventDefault(); newRecord(); }
  else if (ctrl && e.key.toLowerCase() === 'l') { e.preventDefault(); lock(); }
  else if (ctrl && e.key.toLowerCase() === 's' && state.editing) { e.preventDefault(); $('#detail-form').requestSubmit(); }
  else if (e.key === 'Escape' && state.editing && !$$('dialog[open]').length) { cancelEdit(); }
});

/* 시작 */
showAuth();

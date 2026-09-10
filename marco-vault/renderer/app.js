'use strict';
/* Marco Vault 렌더러: 화면 상태 관리 및 UI */

/* 기본 주메뉴 (사용자가 Edit 메뉴에서 자유롭게 바꿀 수 있음) */
const FIELD_KINDS = { text: '일반', secret: '비밀', url: 'URL', date: '날짜', select: '선택' };
const ICONS = ['🔑', '🏦', '💳', '🛡', '🎂', '🌐', '📶', '🖥', '🎫', '🪪', '📝', '📁', '⭐', '🏠', '🚗', '📱', '💊', '🎓'];
function defaultMenus() {
  return [
    { id: 'login', label: '시스템로그인', icon: '🔑', fields: [
      { key: 'username', label: 'ID', kind: 'text' },
      { key: 'password', label: 'Pass', kind: 'secret' },
      { key: 'url', label: 'URL', kind: 'url' },
      { key: 'ip', label: 'IP', kind: 'text' },
    ]},
    { id: 'bank', label: '뱅킹', icon: '🏦', fields: [
      { key: 'bank', label: '은행명', kind: 'text' },
      { key: 'accountNumber', label: '계좌번호', kind: 'text' },
      { key: 'username', label: 'ID', kind: 'text' },
      { key: 'password', label: 'Pass', kind: 'secret' },
      { key: 'url', label: 'URL', kind: 'url' },
    ]},
    { id: 'card', label: '크레디트카드', icon: '💳', fields: [
      { key: 'cardName', label: '카드명', kind: 'text' },
      { key: 'cardNumber', label: '카드번호', kind: 'secret' },
      { key: 'expiry', label: '만료일', kind: 'text' },
      { key: 'pin', label: 'PIN', kind: 'secret' },
      { key: 'cardPassword', label: 'Pass (카드)', kind: 'secret' },
      { key: 'billingAccount', label: '결제계좌', kind: 'text' },
      { key: 'url', label: 'URL', kind: 'url' },
      { key: 'username', label: 'ID', kind: 'text' },
      { key: 'password', label: 'Pass (로그인)', kind: 'secret' },
    ]},
    { id: 'insurance', label: '보험', icon: '🛡', fields: [
      { key: 'company', label: '보험사', kind: 'text' },
      { key: 'product', label: '보험상품', kind: 'text' },
      { key: 'url', label: 'URL', kind: 'url' },
      { key: 'expiry', label: '만기일', kind: 'date' },
      { key: 'premium', label: '보험료', kind: 'text' },
      { key: 'insured', label: '피보험자', kind: 'text' },
    ]},
    { id: 'anniversary', label: '기념일', icon: '🎂', fields: [
      { key: 'kind', label: '구분', kind: 'select', options: ['생일', '결혼기념일', '기일', '기타'] },
      { key: 'name', label: '이름', kind: 'text' },
      { key: 'relation', label: '관계', kind: 'text' },
      { key: 'date', label: '날짜', kind: 'date' },
      { key: 'calendar', label: '양/음', kind: 'select', options: ['양력', '음력'] },
    ]},
  ];
}
function menus() { return state.data.menus; }
function menuOf(id) { return menus().find(m => m.id === id) || null; }
function fieldsOf(id) { const m = menuOf(id); return m ? m.fields : []; }

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
  if (!Array.isArray(state.data.menus) || !state.data.menus.length) state.data.menus = defaultMenus();
  state.data.settings = Object.assign({ autoLockMinutes: 5, clipboardClearSeconds: 30 }, data.settings || {});
  state.selectedId = null; state.editing = false; state.query = '';
  state.view = { kind: 'view', value: 'all' }; $('#list-title').textContent = '전체 항목';
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

  $('#nav-types').innerHTML = menus().map(m =>
    `<li data-type="${m.id}"><span>${m.icon} ${esc(m.label)}</span><span class="count">${typeCounts[m.id] || ''}</span></li>`).join('');
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
function isSecret(type, key) { const f = fieldsOf(type).find(x => x.key === key); return !!(f && f.kind === 'secret'); }
function subtitleOf(r) {
  const f = r.fields || {};
  const first = fieldsOf(r.type).find(x => x.kind !== 'secret' && f[x.key]);
  return (first ? f[first.key] : '') || r.category || menuOf(r.type)?.label || '';
}

function renderList() {
  const recs = filteredRecords();
  $('#list-count').textContent = recs.length + '개';
  $('#list-empty').hidden = recs.length > 0;
  $('#records').innerHTML = recs.map(r => `
    <li data-id="${r.id}" class="${r.id === state.selectedId ? 'active' : ''}">
      <span class="ico">${menuOf(r.type)?.icon || '📄'}</span>
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
  const t = menuOf(r.type) || { label: '(삭제된 주메뉴)', icon: '📄', fields: [] };
  const rows = t.fields.filter(f => r.fields && r.fields[f.key]).map(f => {
    const val = r.fields[f.key];
    let v;
    if (f.kind === 'secret') v = `<span class="v secret" data-secret="${esc(val)}" data-shown="0">••••••••••</span>`;
    else if (f.kind === 'url') v = `<span class="v"><a href="#" data-open="${esc(val)}">${esc(val)}</a></span>`;
    else v = `<span class="v ${f.kind === 'text' ? '' : 'plain'}">${esc(val)}</span>`;
    return `<div class="field"><span class="k">${esc(f.label)}</span>${v}
      <span class="btns">${f.kind === 'secret' ? '<button class="icon" data-toggle title="보기/숨기기">👁</button>' : ''}<button class="icon" data-copy="${esc(val)}" title="복사">📋</button></span></div>`;
  }).join('');
  $('#detail-view').innerHTML = `
    <div class="detail-head">
      <span class="ico">${t.icon}</span>
      <div><h2>${esc(r.title)}</h2><div class="sub">${esc(t.label)} · ${esc(r.category || '미분류')} · 수정 ${fmtDate(r.updatedAt)}</div></div>
      <div class="actions">
        <button data-act="fav" title="즐겨찾기">${r.favorite ? '★' : '☆'}</button>
        <button data-act="edit">✎ 편집</button>
        <button data-act="delete" class="danger">삭제</button>
      </div>
    </div>
    ${rows || (t.fields.length ? '<p class="muted">입력된 항목이 없습니다.</p>' : '')}
    ${r.notes ? `<div class="notes"><label>Memo</label><div class="v">${esc(r.notes)}</div></div>` : ''}`;
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
  const defaultType = state.view.kind === 'type' && menuOf(state.view.value) ? state.view.value : menus()[0].id;
  const r = current() || { id: null, type: defaultType, title: '', category: '', notes: '', fields: {} };
  if (!menuOf(r.type)) r.type = menus()[0].id;
  const form = $('#detail-form');
  const typeOpts = menus().map(m => `<option value="${m.id}" ${m.id === r.type ? 'selected' : ''}>${m.icon} ${esc(m.label)}</option>`).join('');
  const catOpts = ['<option value="">미분류</option>', ...state.data.categories.map(c => `<option value="${esc(c)}" ${c === r.category ? 'selected' : ''}>${esc(c)}</option>`)].join('');
  form.innerHTML = `
    <h2 style="margin-top:0">${r.id ? '항목 편집' : '새 항목'}</h2>
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
      <span class="muted tiny" style="align-self:center">Ctrl+S 저장 · Esc 취소</span>
    </div>`;
  const drawFields = (type, values) => {
    $('#type-fields').innerHTML = fieldsOf(type).map(f => {
      const raw = values[f.key] || '';
      const v = esc(raw);
      const label = esc(f.label);
      if (f.kind === 'secret') return `<label>${label}<div class="pw-wrap"><input type="password" name="f_${f.key}" value="${v}" autocomplete="new-password">
        <button type="button" class="icon" data-eye title="보기/숨기기">👁</button><button type="button" class="icon" data-gen title="생성기">🎲</button></div></label>`;
      if (f.kind === 'select') {
        const opts = (f.options || []).map(o => `<option value="${esc(o)}" ${o === raw ? 'selected' : ''}>${esc(o)}</option>`).join('');
        return `<label>${label}<select name="f_${f.key}"><option value="">선택</option>${opts}</select></label>`;
      }
      if (f.kind === 'date') return `<label>${label}<input type="date" name="f_${f.key}" value="${v}"></label>`;
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
    if (!menuOf(row.type)) row.type = (menus().find(m => m.label === row.type) || menus()[0]).id;
    if (row.category && !state.data.categories.includes(row.category)) state.data.categories.push(row.category);
    state.data.records.push({ id: uid(), favorite: false, createdAt: now, updatedAt: now, ...row });
    n++;
  }
  if (await persist()) { renderAll(); status(`${n}개 항목을 가져왔습니다.`); }
});

/* ---------- 주메뉴 편집 (Edit) ---------- */
const me = { sel: null };
function openMenuEditor() {
  me.sel = menus()[0]?.id || null;
  $('#me-icon').innerHTML = ICONS.map(i => `<option value="${i}">${i}</option>`).join('');
  renderMenuEditor();
  $('#dlg-menus').showModal();
}
function renderMenuEditor() {
  const m = menuOf(me.sel);
  $('#me-menus').innerHTML = menus().map(x => `<li data-id="${x.id}" class="${x.id === me.sel ? 'active' : ''}"><span>${x.icon} ${esc(x.label)}</span></li>`).join('');
  $('.me-right').hidden = !m;
  if (!m) return;
  $('#me-icon').value = m.icon;
  $('#me-label').value = m.label;
  const kindOpts = (k) => Object.entries(FIELD_KINDS).map(([v, l]) => `<option value="${v}" ${v === k ? 'selected' : ''}>${l}</option>`).join('');
  $('#me-fields tbody').innerHTML = m.fields.map((f, i) => `
    <tr data-i="${i}">
      <td><input type="text" data-f="label" value="${esc(f.label)}" maxlength="20"></td>
      <td><select data-f="kind">${kindOpts(f.kind)}</select></td>
      <td><input type="text" data-f="options" value="${esc((f.options || []).join(', '))}" ${f.kind === 'select' ? '' : 'disabled'} placeholder="예: 양력, 음력"></td>
      <td><button type="button" class="icon" data-up title="위로">▲</button><button type="button" class="icon" data-down title="아래로">▼</button><button type="button" class="icon danger" data-del title="삭제">✕</button></td>
    </tr>`).join('');
}
async function menusChanged() { await persist(); renderSidebar(); renderList(); if (state.editing) renderForm(); else renderDetail(); }

$('#btn-edit-menus').addEventListener('click', openMenuEditor);
$('#me-close').addEventListener('click', () => $('#dlg-menus').close());
$('#me-menus').addEventListener('click', e => { const li = e.target.closest('li'); if (li) { me.sel = li.dataset.id; renderMenuEditor(); } });
$('#me-add-menu').addEventListener('click', async () => {
  const m = { id: 'm_' + uid(), label: '새 주메뉴', icon: '📁', fields: [{ key: 'f_' + uid(), label: '항목 1', kind: 'text' }] };
  menus().push(m); me.sel = m.id;
  renderMenuEditor(); await menusChanged();
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
  me.sel = menus()[0].id;
  renderMenuEditor(); await menusChanged();
});
$('#me-label').addEventListener('change', async e => { const m = menuOf(me.sel); if (!m) return; m.label = e.target.value.trim() || m.label; renderMenuEditor(); await menusChanged(); });
$('#me-icon').addEventListener('change', async e => { const m = menuOf(me.sel); if (!m) return; m.icon = e.target.value; renderMenuEditor(); await menusChanged(); });
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
  } else if (btn.hasAttribute('data-up') && i > 0) { [m.fields[i - 1], m.fields[i]] = [m.fields[i], m.fields[i - 1]]; }
  else if (btn.hasAttribute('data-down') && i < m.fields.length - 1) { [m.fields[i + 1], m.fields[i]] = [m.fields[i], m.fields[i + 1]]; }
  else return;
  renderMenuEditor(); await menusChanged();
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

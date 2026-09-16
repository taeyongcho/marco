'use strict';
/* MySafe 렌더러 */

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

const state = {
  data: null, view: { kind: 'view', value: 'all' }, selectedId: null, editing: false, query: '',
  sort: 'title', viewMode: 'compact', lockTimer: null, genTarget: null, info: null, forceSetup: false,
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
/** 날짜 입력칸의 연도를 4자리로 교정 */
function clampDateInput(el) { const fixed = clampYmd(el.value); if (fixed !== null) el.value = fixed; }
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
/** 주메뉴별 카테고리 (없으면 공용 카테고리) */
function categoriesOf(menuId) {
  const m = menuOf(menuId);
  return (m && Array.isArray(m.categories) && m.categories.length) ? m.categories : state.data.categories;
}
function allCategories() {
  const set = new Set(state.data.categories);
  for (const m of menus()) for (const c of (m.categories || [])) set.add(c);
  return [...set];
}

/* ---------- 저장 ---------- */
let saveTimer = null;
/** 연속된 편집을 모아 한 번만 저장한다 (입력 중 멈춤 현상 방지) */
function schedulePersist(delay = 400) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { saveTimer = null; persist(); }, delay);
}
async function flushPersist() {
  if (!saveTimer) return true;
  clearTimeout(saveTimer); saveTimer = null;
  return persist();
}
async function persist() {
  const r = await window.vault.save(state.data);
  if (!r.ok) { toast('저장 실패: ' + r.error, 'err', 6000); return false; }
  return true;
}

/* ---------- 라이선스 ---------- */
let license = { licensed: false };
async function refreshLicense() {
  license = await window.vault.licenseGet();
  const name = license.licensed ? license.user : '';
  const trial = license.licensed && license.type === 1;
  $('#auth-user').textContent = name; $('#auth-user').hidden = !name;
  $('#auth-user').classList.toggle('trial', trial);
  $('#brand-user').textContent = name; $('#brand-user').hidden = !name;
  $('#auth-lic-status').textContent = license.licensed
    ? `${license.typeLabel} · ${name}` + (license.expires ? ` (${license.daysLeft >= 0 ? license.daysLeft + '일 남음' : '만료됨'})` : '')
    : (license.error ? '라이선스 오류: ' + license.error : '라이선스 미등록');
  $('#btn-license').textContent = license.licensed ? '변경' : '라이선스 등록';
  $('#about-license').innerHTML = license.licensed
    ? `<b>${esc(license.typeLabel)}</b> · 사용자 ${esc(name)}<br>${license.expires ? `만료일 ${license.expires} (${license.daysLeft >= 0 ? license.daysLeft + '일 남음' : '만료됨'})` : '기간 제한 없음'}`
    : '등록된 라이선스가 없습니다. 체험판 또는 영구 라이선스를 등록하세요.';
  $('#btn-license-clear').hidden = !license.licensed;
  document.title = name ? `MySafe - ${name}` : 'MySafe';
  window.vault.setTitle(document.title);
}
/** 사용 중에도 10분마다 시계를 확인해 되돌리면 잠근다 */
setInterval(async () => {
  if (!state.data) return;
  const info = await window.vault.licenseGet();
  if (info.clockIssue || info.expired || !info.licensed) { await lock(true); }
}, 10 * 60 * 1000);

/** 잠금 해제 직후 라이선스 상태 안내 */
function licenseNotice() {
  if (!license.licensed) return;
  if (license.type === 1) {
    const d = license.daysLeft;
    if (d === null) return;
    if (d < 0) toast('체험판 라이선스가 만료되었습니다. 영구 라이선스를 등록해 주세요.', 'err', 8000);
    else if (d === 0) toast('체험판 라이선스가 오늘 만료됩니다.', 'err', 8000);
    else if (d <= 7) toast(`체험판 라이선스가 ${d}일 남았습니다. 계속 사용하시려면 영구 라이선스를 등록해 주세요.`, 'err', 8000);
    else toast(`체험판 라이선스 · ${d}일 남았습니다.`, 'info', 5000);
  } else if (license.expires) {
    toast(`라이선스 만료일 ${license.expires} (${license.daysLeft}일 남음)`, 'info', 5000);
  } else {
    toast(`영구 라이선스 · ${license.user} 님, 기간 제한 없이 사용하실 수 있습니다.`, 'info', 5000);
  }
}
function openLicenseDialog() {
  $('#lic-user').value = license.licensed ? license.user : '';
  $('#lic-key').value = '';
  $('#lic-msg').textContent = ''; $('#lic-msg').className = 'tiny';
  $('#dlg-license').showModal(); setTimeout(() => $('#lic-user').focus(), 30);
}
$('#btn-license').addEventListener('click', openLicenseDialog);
$('#btn-license-required').addEventListener('click', openLicenseDialog);
$('#btn-clock-recheck').addEventListener('click', async () => {
  await showAuth();
  if (!license.clockIssue) toast('날짜가 정상으로 확인되었습니다.');
});
$('#btn-license2').addEventListener('click', openLicenseDialog);
$('#lic-cancel').addEventListener('click', () => $('#dlg-license').close());
$('#form-license').addEventListener('submit', async e => {
  e.preventDefault();
  const r = await window.vault.licenseSet($('#lic-user').value, $('#lic-key').value);
  const msg = $('#lic-msg');
  if (!r.ok) { msg.textContent = r.error; msg.className = 'tiny error'; return; }
  await refreshLicense();
  $('#dlg-license').close();
  toast(`${license.typeLabel} 라이선스를 등록했습니다: ${license.user}`);
  if (!state.data) showAuth();   // 잠금 화면이면 다시 그려서 입력창을 연다
});
$('#btn-license-clear').addEventListener('click', async () => {
  if (!confirm('등록된 라이선스를 해제할까요?')) return;
  await window.vault.licenseClear(); await refreshLicense(); toast('라이선스를 해제했습니다.', 'info');
});

/* ---------- 인증 화면 ---------- */
async function showAuth() {
  await refreshLicense();   // 잠금 화면으로 돌아올 때마다 만료 여부를 다시 확인
  $('#screen-main').hidden = true;
  $('#screen-auth').hidden = false;
  $('#auth-error').hidden = true;
  const info = await window.vault.info(); state.info = info;
  $('#auth-path').textContent = '볼트 파일: ' + info.path;
  // 지정한 위치에 파일이 없거나, 되살릴 수 있는 볼트가 남아 있으면 복구 화면을 보여 준다.
  // (예전에 쓰던 볼트가 있는데 빈 볼트를 새로 만들게 두면 데이터를 잃은 것처럼 보인다)
  const cands = info.candidates || [];
  let missing = !info.exists && (!info.isDefault || cands.length > 0);
  if (state.forceSetup && !info.exists && info.isDefault) { missing = false; state.forceSetup = false; }
  // 라이선스가 없거나 만료됐거나 시계를 되돌린 경우 잠금 해제를 막는다 (데이터는 그대로 보관)
  const blocked = !!license.clockIssue || !license.licensed || license.expired;
  $('#auth-locked-lic').hidden = !blocked;
  $('#form-setup').hidden = blocked || info.exists || missing;
  $('#form-unlock').hidden = blocked || !info.exists;
  $('#auth-missing').hidden = blocked || !missing;
  if (missing) renderCandidates(info, cands);
  if (blocked) {
    $('#btn-license-required').hidden = !!license.clockIssue;
    $('#btn-clock-recheck').hidden = !license.clockIssue;
    $('#lic-block-msg').innerHTML = license.clockIssue === 'rollback'
      ? `<b>시스템 날짜가 되돌려진 것으로 보입니다.</b><br>이 PC에서 마지막으로 확인된 날짜는 ${esc(license.clockSeen)} 입니다.<br>Windows 날짜/시간을 현재 날짜로 맞춘 뒤 「다시 확인」을 눌러 주세요.`
      : license.clockIssue === 'tampered'
      ? `<b>라이선스 사용 기록이 손상되었거나 변경되었습니다.</b><br>Windows 날짜/시간을 확인한 뒤 「다시 확인」을 누르거나, 라이선스를 다시 등록해 주세요.`
      : !license.licensed
      ? (license.error ? `라이선스에 문제가 있습니다.<br>${esc(license.error)}<br>라이선스를 다시 입력해 주세요.`
                       : 'MySafe를 사용하려면 라이선스 등록이 필요합니다.<br>체험판 또는 영구 라이선스 키를 입력해 주세요.')
      : `<b>${esc(license.typeLabel)} 라이선스가 만료되었습니다.</b><br>만료일 ${esc(license.expires)}<br>계속 사용하려면 라이선스를 다시 입력해 주세요.`;
    $('#lic-block-sub').textContent = license.clockIssue
      ? '저장된 데이터는 그대로 보관됩니다. 날짜를 바로잡으면 바로 다시 사용할 수 있습니다.'
      : '저장된 데이터는 그대로 보관됩니다. 라이선스를 등록하면 바로 다시 사용할 수 있습니다.';
    $('#auth-subtitle').textContent = license.clockIssue ? '시스템 날짜를 확인해 주세요.' : '라이선스 확인이 필요합니다.';
    return;
  }
  $('#auth-subtitle').textContent = info.exists ? '마스터 비밀번호를 입력해 잠금을 해제하세요.'
    : missing ? '지정된 위치에서 볼트 파일을 찾지 못했습니다.' : '처음 사용합니다. 마스터 비밀번호를 만들어 주세요.';
  const input = info.exists ? $('#unlock-pw') : $('#setup-pw');
  input.value = ''; setTimeout(() => input.focus(), 50);
}
function authError(msg) { const el = $('#auth-error'); el.textContent = msg; el.hidden = false; }

/* ---------- 볼트 파일 되찾기 ---------- */
const CAND_LABEL = { default: '기본 위치', previous: '이전 위치', backup: '백업 파일', auto: '자동 백업' };
function fmtSize(n) { return n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(1) + ' MB'; }
function candidateHtml(c, withDelete) {
  const del = withDelete && (c.kind === 'backup' || c.kind === 'auto')
    ? `<button type="button" class="icon danger cand-del" data-del-cand="${esc(c.path)}" title="이 백업 파일 지우기">${ico('trash')}</button>` : '';
  return `<div class="cand-row"><button type="button" data-cand="${esc(c.path)}">
    <span class="cand-kind">${esc(CAND_LABEL[c.kind] || '파일')}</span>
    <span class="cand-meta"><span class="cand-when">${esc(fmtDate(c.mtime))} · ${esc(fmtSize(c.size))}</span>
      <div class="cand-path">${esc(c.path)}</div></span></button>${del}</div>`;
}
function renderCandidates(info, cands) {
  $('#missing-path').textContent = info.path;
  $('#candidates').innerHTML = cands.length
    ? `<p class="muted tiny">되살릴 수 있는 볼트 파일 ${cands.length}개를 찾았습니다. 최근 것부터 보여 줍니다.</p>` + cands.map(candidateHtml).join('')
    : '<p class="empty-note">되살릴 수 있는 파일을 찾지 못했습니다. 아래에서 직접 찾아 주세요.</p>';
}
async function useCandidate(p, afterOk) {
  const r = await window.vault.useCandidate(p);
  if (!r.ok) { authError(r.error); return false; }
  if (afterOk) afterOk();
  return true;
}
$('#candidates').addEventListener('click', async e => {
  const b = e.target.closest('button[data-cand]'); if (!b) return;
  if (await useCandidate(b.dataset.cand)) showAuth();
});

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
$('#btn-use-default').addEventListener('click', async () => {
  if (!confirm('기존 데이터 없이 빈 볼트를 새로 만듭니다.\n\n예전에 쓰던 볼트 파일이 어딘가에 남아 있다면 지금 되살리는 편이 좋습니다. 그래도 새로 시작할까요?')) return;
  await window.vault.useDefaultLocation();
  state.forceSetup = true;
  showAuth();
});

/* ---------- 메인 ---------- */
let migratedOnOpen = false;   // 이번 실행에서 주메뉴 구성이 갱신되었는지
function migrate(data) {
  data.records ||= []; data.categories ||= [];
  const fresh = !Array.isArray(data.menus) || !data.menus.length;
  if (fresh) data.menus = defaultMenus();
  for (const m of data.menus) {
    if (EMOJI_TO_ICON[m.icon]) m.icon = EMOJI_TO_ICON[m.icon];
    if (!ICON_PATHS[m.icon]) m.icon = 'folder';
    for (const f of m.fields) if (m.id === 'anniversary' && f.key === 'date' && f.kind === 'date') f.kind = 'yearly';
  }
  if (!fresh && (data.menuVersion || 1) < MENU_VERSION) {
    migrateMenus(data);
    migratedOnOpen = true;
  }
  data.menuVersion = MENU_VERSION;
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
  if (migratedOnOpen) {
    migratedOnOpen = false;
    window.vault.backup().then(async r => {
      await persist();
      toast('주메뉴 구성을 최신 버전으로 업데이트했습니다. 입력하신 내용은 그대로 보존됩니다.' + (r.ok && r.data ? ' (기존 볼트 파일 백업 완료)' : ''), 'info', 7000);
    });
  }
  licenseNotice();
  notifyUpcoming();
  restoreDraft();
}
let draft = null; // 자동 잠금 시 편집 중이던 내용 (잠금 해제 후 복원)
function captureDraft() {
  const form = $('#detail-form'); if (!state.editing || !form.type) return null;
  return { id: state.selectedId, type: form.type.value, category: form.category.value, title: form.title.value, notes: form.notes.value, fields: collectFields(form) };
}
function restoreDraft() {
  if (!draft) return;
  const d = draft; draft = null;
  if (d.id && !state.data.records.find(r => r.id === d.id)) return;
  state.selectedId = d.id; state.editing = true; renderList(); renderDetail();
  const form = $('#detail-form');
  form.type.value = d.type; form.type.dispatchEvent(new Event('change'));
  form.category.value = d.category; form.title.value = d.title; form.notes.value = d.notes;
  for (const [k, v] of Object.entries(d.fields)) { const el = form.querySelector(`[name="f_${k}"]`); if (el) el.value = v; }
  toast('잠금 전 편집 중이던 내용을 복원했습니다. 저장을 눌러 주세요.', 'info', 5000);
}
async function lock(auto = false) {
  if (!state.data) return;
  await flushPersist();
  if (state.editing) {
    if (auto) draft = captureDraft();
    else if (!confirm('편집 중인 내용이 저장되지 않았습니다. 잠글까요?')) return;
  }
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
  if (min > 0) state.lockTimer = setTimeout(() => lock(true), min * 60 * 1000);
}
// 사용자 활동(마우스 이동·클릭·휠, 키 입력, 입력창 타이핑, 스크롤, 창 포커스)이 있으면 카운트를 처음부터 다시 시작
['mousemove', 'keydown', 'mousedown', 'wheel', 'input', 'scroll', 'focus'].forEach(ev => document.addEventListener(ev, () => { if (state.data) resetLockTimer(); }, { passive: true, capture: true }));
window.addEventListener('focus', () => { if (state.data) resetLockTimer(); });
window.vault.onLockRequest(() => lock(true));

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
  const inMenu = state.view.kind === 'type' ? state.view.value : null;
  const cats = inMenu ? categoriesOf(inMenu) : allCategories();
  const scope = inMenu ? recs.filter(r => r.type === inMenu) : recs;
  const scopedCount = c => scope.filter(r => (r.category || '') === c).length;
  $('#cat-scope').textContent = inMenu ? menuOf(inMenu)?.label || '' : '전체';
  $('#nav-categories').innerHTML = cats.map(c =>
    `<li data-category="${esc(c)}" title="우클릭: 삭제"><span>${ico('folder')} ${esc(c)}</span><span class="count">${scopedCount(c) || ''}</span></li>`).join('')
    + `<li data-category=""><span>${ico('folderOpen')} 미분류</span><span class="count">${scopedCount('') || ''}</span></li>`;
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
$('#nav-categories').addEventListener('click', e => {
  const li = e.target.closest('li'); if (!li) return;
  const inMenu = state.view.kind === 'type' ? state.view.value : (state.view.kind === 'category' ? state.view.menu : null);
  const label = li.dataset.category || '미분류';
  setView('category', li.dataset.category, inMenu ? `${menuOf(inMenu).label} · ${label}` : label, inMenu);
});
$('#nav-categories').addEventListener('contextmenu', async e => {
  const li = e.target.closest('li'); if (!li || !li.dataset.category) return;
  const c = li.dataset.category;
  if (!confirm(`카테고리 "${c}"를 삭제할까요? 해당 항목은 미분류가 됩니다.`)) return;
  const inMenu = state.view.kind === 'type' ? state.view.value : null;
  if (inMenu && menuOf(inMenu)?.categories) {
    menuOf(inMenu).categories = menuOf(inMenu).categories.filter(x => x !== c);
    state.data.records.forEach(r => { if (r.type === inMenu && r.category === c) r.category = ''; });
  } else {
    state.data.categories = state.data.categories.filter(x => x !== c);
    for (const m of menus()) if (m.categories) m.categories = m.categories.filter(x => x !== c);
    state.data.records.forEach(r => { if (r.category === c) r.category = ''; });
  }
  if (state.view.kind === 'category' && state.view.value === c) state.view = { kind: 'view', value: 'all' };
  if (await persist()) renderAll();
});
function setView(kind, value, title, menu) {
  if (state.editing && !confirm('편집 중인 내용을 버릴까요?')) return;
  state.view = { kind, value, menu: menu || null };
  $('#list-title').textContent = title.trim();
  if (kind === 'view' && value === 'upcoming' && state.sort !== 'dday') { $('#sort').value = 'dday'; state.sort = 'dday'; }
  // 화면을 바꾸면 오른쪽 블럭(상세 보기·편집 폼)도 함께 비운다
  state.editing = false; state.selectedId = null;
  renderSidebar(); renderList(); renderDetail();
}

/* 목록 */
function filteredRecords() {
  const q = state.query.trim().toLowerCase();
  const v = state.view;
  let recs;
  if (v.kind === 'view' && v.value === 'upcoming') recs = upcomingRecords().map(x => x.r);
  else recs = state.data.records.filter(r => {
    if (v.kind === 'type') return r.type === v.value;
    if (v.kind === 'category') return (r.category || '') === v.value && (!v.menu || r.type === v.menu);
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
  const first = fieldsOf(r.type).find(x => !['secret', 'date', 'yearly', 'memo'].includes(x.kind) && f[x.key]);
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
      const hint = f.kind === 'yearly' ? dateHint(val, r.fields.calendar) : '';
      v = `<span class="v plain">${esc(val)}${hint ? ` <span class="muted tiny">${esc(hint)}</span>` : ''} ${dd ? `<span class="chip dday ${ddayClass(dd)}">${ddayLabel(dd)}${f.kind === 'yearly' && dd.years > 0 ? ` · ${dd.years}회째` : ''}</span>` : ''}</span>`;
    }
    else if (f.kind === 'memo') v = `<span class="v plain memo-v">${esc(val)}</span>`;
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
  const catOptsFor = (type, sel) => ['<option value="">미분류</option>',
    ...categoriesOf(type).map(c => `<option value="${esc(c)}" ${c === sel ? 'selected' : ''}>${esc(c)}</option>`)].join('');
  const hideTitle = !!menuOf(r.type)?.hideTitle;
  form.innerHTML = `
    <div class="card">
      <h2>${r.id ? '항목 편집' : '새 항목'}</h2>
      <div class="form-row">
        <label>주메뉴 <select name="type">${typeOpts}</select></label>
        <label>카테고리 <select name="category">${catOptsFor(r.type, r.category)}</select></label>
      </div>
      <label id="title-row" ${hideTitle ? 'hidden' : ''}>제목 <input type="text" name="title" value="${esc(r.title)}" placeholder="예: 회사 그룹웨어, 국민은행"></label>
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
        return `<label>${label}<select name="f_${f.key}" ${f.auto ? `data-auto="${f.auto}"` : ''}><option value="">선택</option>${opts}</select></label>`;
      }
      if (f.kind === 'memo') return `<label>${label}<textarea name="f_${f.key}" rows="4" placeholder="한 줄에 하나씩 적어 주세요">${v}</textarea></label>`;
      if (f.kind === 'date' || f.kind === 'yearly') return `<label>${label}${f.kind === 'yearly' ? ' <span class="muted">(매년 반복)</span>' : ''}
        <span class="date-wrap"><input type="date" name="f_${f.key}" value="${v}" min="${DATE_MIN}" max="${DATE_MAX}">${f.kind === 'yearly' ? `<span class="date-hint" data-hint-for="${f.key}"></span>` : ''}</span></label>`;
      return `<label>${label}<input type="${f.kind === 'url' ? 'url' : 'text'}" name="f_${f.key}" value="${v}" ${f.kind === 'url' ? 'placeholder="https://"' : ''}></label>`;
    }).join('');
    updateDateHints();
  };
  /** 날짜 옆 요일 안내와 띠 자동 채움 */
  function updateDateHints() {
    const cal = form.querySelector('[name=f_calendar]');
    for (const el of form.querySelectorAll('input[type=date]')) {
      const hintEl = form.querySelector(`[data-hint-for="${el.name.slice(2)}"]`);
      if (hintEl) hintEl.textContent = dateHint(el.value, cal ? cal.value : '');
    }
    const zodiacEl = form.querySelector('[data-auto=zodiac]');
    const dateEl = form.querySelector('[name=f_date]');
    if (zodiacEl && dateEl && dateEl.value && !zodiacEl.value) zodiacEl.value = zodiacOf(dateEl.value) || '';
  }
  drawFields(r.type, r.fields || {});
  form.addEventListener('change', e => {
    if (e.target.type === 'date') clampDateInput(e.target);
    if (e.target.type === 'date' || e.target.name === 'f_calendar') updateDateHints();
    if (e.target.name === 'f_date') {
      const z = form.querySelector('[data-auto=zodiac]');
      if (z) z.value = zodiacOf(e.target.value) || '';
    }
  });
  form.querySelector('[name=type]').addEventListener('change', e => {
    const type = e.target.value;
    form.querySelector('[name=category]').innerHTML = catOptsFor(type, form.querySelector('[name=category]').value);
    $('#title-row').hidden = !!menuOf(type)?.hideTitle;
    drawFields(type, collectFields(form));
  });
  setTimeout(() => {
    const first = hideTitle ? form.querySelector('#type-fields input, #type-fields select, #type-fields textarea') : form.querySelector('[name=title]');
    if (first) first.focus();
  }, 30);
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
  const type = form.type.value, fields = collectFields(form);
  const menu = menuOf(type);
  const title = composeTitle(menu, fields, form.title.value.trim());
  const rec = {
    id: r ? r.id : uid(), type, title, category: form.category.value,
    notes: form.notes.value, fields, favorite: r ? !!r.favorite : false, createdAt: r ? r.createdAt : now, updatedAt: now,
  };
  if (!rec.title) { toast(menu?.hideTitle ? '내용을 한 가지 이상 입력해 주세요.' : '제목을 입력해 주세요.', 'err'); return; }
  if (r) Object.assign(r, rec); else state.data.records.push(rec);
  state.selectedId = rec.id; state.editing = false;
  if (await persist()) { renderAll(); toast('저장했습니다.'); }
});
function newRecord() {
  if (state.editing && !confirm('편집 중인 내용을 버릴까요?')) return;
  state.selectedId = null; state.editing = true; renderList(); renderDetail();
}
$('#btn-new').addEventListener('click', newRecord);
$('#btn-lock').addEventListener('click', () => lock(false));

/* 카테고리 */
$('#btn-add-category').addEventListener('click', () => { $('#cat-name').value = ''; $('#dlg-category').showModal(); });
$('#cat-cancel').addEventListener('click', () => $('#dlg-category').close());
$('#form-category').addEventListener('submit', async e => {
  const name = $('#cat-name').value.trim();
  if (!name) return e.preventDefault();
  const inMenu = state.view.kind === 'type' ? state.view.value : null;
  const m = inMenu ? menuOf(inMenu) : null;
  if (m) { m.categories ||= []; if (!m.categories.includes(name)) m.categories.push(name); }
  else if (!state.data.categories.includes(name)) state.data.categories.push(name);
  await persist();
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
  $('#set-backups-dir').textContent = info.backupsDir;
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
  if (r.data) {
    await refreshPathBox();
    toast('볼트 파일을 옮겼습니다.' + (r.data.kept ? ' 이전 위치의 파일은 백업으로 남겨 두었습니다.' : ''), 'ok', 6000);
  }
});
$('#btn-move-default').addEventListener('click', async () => {
  const r = await window.vault.moveToDefault();
  if (!r.ok) return toast(r.error, 'err', 5000);
  await refreshPathBox();
  toast('기본 위치로 되돌렸습니다.' + (r.data && r.data.kept ? ' 이전 위치의 파일은 백업으로 남겨 두었습니다.' : ''), 'ok', 6000);
});
$('#btn-show-folder').addEventListener('click', () => window.vault.showInFolder());
$('#btn-open-backups').addEventListener('click', () => window.vault.openBackupsDir());
$('#btn-restore').addEventListener('click', async () => {
  const box = $('#restore-list');
  const cands = await window.vault.candidates();
  box.hidden = false;
  box.innerHTML = cands.length
    ? '<p class="muted tiny">고른 파일로 바꾸면 지금 볼트는 백업으로 남겨 둡니다. 바꾼 뒤에는 그 파일의 마스터 비밀번호로 잠금을 풉니다. 필요 없는 백업은 휴지통 단추로 지울 수 있습니다.</p>' + cands.map(c => candidateHtml(c, true)).join('')
    : '<p class="empty-note">되살릴 수 있는 파일이 없습니다.</p>';
});
$('#restore-list').addEventListener('click', async e => {
  const d = e.target.closest('button[data-del-cand]');
  if (d) {
    if (!confirm('이 백업 파일을 지울까요? 되돌릴 수 없습니다.')) return;
    const r = await window.vault.deleteBackup(d.dataset.delCand);
    if (!r.ok) return toast(r.error, 'err', 5000);
    d.closest('.cand-row').remove(); toast('백업 파일을 지웠습니다.');
    return;
  }
  const b = e.target.closest('button[data-cand]'); if (!b) return;
  if (!confirm('이 파일로 되돌릴까요?\n\n지금 쓰고 있는 볼트는 백업으로 남겨 두며, 되돌린 뒤에는 그 파일의 마스터 비밀번호로 잠금을 풀어야 합니다.')) return;
  const r = await window.vault.useCandidate(b.dataset.cand);
  if (!r.ok) return toast(r.error, 'err', 6000);
  $('#dlg-settings').close();
  state.data = null; state.selectedId = null; state.editing = false;
  clearTimeout(state.lockTimer);
  showAuth();
  toast('백업 파일로 되돌렸습니다. 해당 볼트의 마스터 비밀번호를 입력해 주세요.', 'info', 7000);
});
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
  refreshMenuList();
  $('.me-right').hidden = !m; if (!m) return;
  $('#me-icon-btn').innerHTML = ico(m.icon); $('#me-label').value = m.label;
  $('#me-categories').value = (m.categories || []).join(', ');
  $('#me-cat-hint').textContent = (m.categories && m.categories.length) ? '' : '(비우면 공용 카테고리를 사용합니다)';
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
/** 편집 중이면 입력값을 유지한 채 폼을 다시 그린다 */
function renderFormPreserving() {
  const form = $('#detail-form');
  if (!form.type) return renderForm();
  const keep = { type: form.type.value, category: form.category.value, title: form.title.value, notes: form.notes.value, fields: collectFields(form) };
  renderForm();
  const f2 = $('#detail-form');
  if (f2.type) {
    f2.type.value = keep.type; f2.type.dispatchEvent(new Event('change'));
    f2.category.value = keep.category; f2.title.value = keep.title; f2.notes.value = keep.notes;
    for (const [k, v] of Object.entries(keep.fields)) { const el = f2.querySelector(`[name="f_${k}"]`); if (el) el.value = v; }
  }
}
let viewRefreshTimer = null;
/** 주메뉴 편집 창 뒤의 화면을 모아서 한 번만 갱신한다 */
function scheduleViewRefresh() {
  clearTimeout(viewRefreshTimer);
  viewRefreshTimer = setTimeout(() => {
    viewRefreshTimer = null;
    renderSidebar(); renderList();
    if (state.editing) renderFormPreserving(); else renderDetail();
  }, 300);
}
async function menusChanged() { await persist(); renderSidebar(); renderList(); if (state.editing) renderFormPreserving(); else renderDetail(); }
function refreshMenuList() {
  $('#me-menus').innerHTML = menus().map(x => `<li data-id="${x.id}" class="${x.id === me.sel ? 'active' : ''}"><span>${ico(x.icon)} ${esc(x.label)}</span></li>`).join('');
}
$('#btn-edit-menus').addEventListener('click', openMenuEditor);
$('#me-close').addEventListener('click', async () => { $('#dlg-menus').close(); await flushPersist(); renderSidebar(); renderList(); });
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
$('#me-label').addEventListener('input', e => {
  const m = menuOf(me.sel); if (!m) return;
  m.label = e.target.value.trim() || m.label;
  refreshMenuList(); schedulePersist(); scheduleViewRefresh();
});
$('#me-categories').addEventListener('input', e => {
  const m = menuOf(me.sel); if (!m) return;
  const list = e.target.value.split(',').map(x => x.trim()).filter(Boolean);
  if (list.length) m.categories = list; else delete m.categories;
  $('#me-cat-hint').textContent = list.length ? '' : '(비우면 공용 카테고리를 사용합니다)';
  schedulePersist(); scheduleViewRefresh();
});
$('#me-icon-btn').addEventListener('click', () => { $('#me-icon-grid').hidden = !$('#me-icon-grid').hidden; });
$('#me-icon-grid').addEventListener('click', async e => {
  const b = e.target.closest('button[data-icon]'); const m = menuOf(me.sel); if (!b || !m) return;
  m.icon = b.dataset.icon; $('#me-icon-grid').hidden = true;
  $('#me-icon-btn').innerHTML = ico(m.icon);
  $$('#me-icon-grid button').forEach(x => x.classList.toggle('active', x.dataset.icon === m.icon));
  refreshMenuList(); schedulePersist(); scheduleViewRefresh();
});
$('#me-add-field').addEventListener('click', async () => {
  const m = menuOf(me.sel); if (!m) return;
  m.fields.push({ key: 'f_' + uid(), label: '새 항목', kind: 'text' });
  renderMenuEditor(); await menusChanged();
  const inputs = $$('#me-fields input[data-f=label]'); const last = inputs[inputs.length - 1]; if (last) { last.focus(); last.select(); }
});
$('#me-fields').addEventListener('input', e => {
  const m = menuOf(me.sel); const tr = e.target.closest('tr'); if (!m || !tr) return;
  const f = m.fields[Number(tr.dataset.i)]; if (!f) return;
  const what = e.target.dataset.f;
  if (what === 'label') f.label = e.target.value.trim() || f.label;
  else if (what === 'kind') {
    f.kind = e.target.value;
    if (f.kind === 'select' && !f.options) f.options = [];
    const opt = tr.querySelector('[data-f=options]');
    if (opt) opt.disabled = f.kind !== 'select';   // 행을 다시 그리지 않고 입력 상태만 바꾼다
  } else if (what === 'options') f.options = e.target.value.split(',').map(x => x.trim()).filter(Boolean);
  else return;
  schedulePersist(); scheduleViewRefresh();
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
  else if (ctrl && k === 'l') { e.preventDefault(); lock(false); }
  else if (ctrl && k === 's' && state.editing) { e.preventDefault(); $('#detail-form').requestSubmit(); }
  else if (e.key === 'Escape' && state.editing && !$$('dialog[open]').length) cancelEdit();
});

/* 버전 표시 */
async function showVersion() {
  const v = await window.vault.version();
  $('#app-version').textContent = v;
  $('#about-version').textContent = v;
  // 설치 폴더에 있던 볼트를 안전한 곳으로 옮겼으면 알린다
  const r = await window.vault.rescued();
  if (r) {
    setTimeout(() => toast(`볼트 파일이 프로그램 설치 폴더에 있어 안전한 위치로 옮겼습니다.\n${r.to}\n설치 폴더는 업데이트할 때 지워지는 곳입니다.`, 'info', 12000), 400);
  }
}

/* 시작 */
hydrateIcons();
showVersion();
applyAppearance();
showAuth();

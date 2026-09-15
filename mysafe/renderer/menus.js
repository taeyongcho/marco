'use strict';
/* MySafe 주메뉴 정의·마이그레이션과 날짜/띠 계산 (DOM에 의존하지 않는 부분) */

const FIELD_KINDS = { text: '일반', secret: '비밀', url: 'URL', memo: '메모', date: '날짜', yearly: '기념일', select: '선택' };
const DEFAULT_SETTINGS = { autoLockMinutes: 5, clipboardClearSeconds: 30, notifyDays: 30, notify: true };
const MENU_VERSION = 2;
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
const ZODIAC = ['원숭이', '닭', '개', '돼지', '쥐', '소', '호랑이', '토끼', '용', '뱀', '말', '양'];
const DATE_MIN = '1900-01-01', DATE_MAX = '2999-12-31';

function defaultMenus() {
  return [
    { id: 'login', label: '시스템로그인', icon: 'key', fields: [
      { key: 'username', label: 'ID', kind: 'text' },
      { key: 'password', label: 'Pass', kind: 'secret' },
      { key: 'email', label: 'e-Mail', kind: 'text' },
      { key: 'url', label: 'URL', kind: 'url' },
      { key: 'ip', label: 'IP', kind: 'text' },
    ]},
    { id: 'bank', label: '뱅킹', icon: 'bank', fields: [
      { key: 'bank', label: '은행명', kind: 'text' },
      { key: 'holder', label: '예금주', kind: 'text' },
      { key: 'accountNumber', label: '계좌번호', kind: 'text' },
      { key: 'username', label: 'ID', kind: 'text' },
      { key: 'password', label: 'Pass', kind: 'secret' },
      { key: 'url', label: 'URL', kind: 'url' },
      { key: 'autoTransfer', label: '자동이체 리스트', kind: 'memo' },
    ]},
    { id: 'card', label: '크레디트카드', icon: 'card', fields: [
      { key: 'cardName', label: '카드명', kind: 'text' },
      { key: 'cardNumber', label: '카드번호', kind: 'secret' },
      { key: 'expiry', label: '만료일', kind: 'date' },
      { key: 'pin', label: 'PIN', kind: 'secret' },
      { key: 'cardPassword', label: '카드비번', kind: 'secret' },
      { key: 'billingBank', label: '결제은행', kind: 'text' },
      { key: 'billingAccount', label: '결제계좌', kind: 'text' },
      { key: 'billingDay', label: '결제일', kind: 'text' },
      { key: 'url', label: 'URL', kind: 'url' },
      { key: 'username', label: 'ID', kind: 'text' },
      { key: 'password', label: 'Pass (로그인)', kind: 'secret' },
    ]},
    { id: 'insurance', label: '보험', icon: 'shield',
      categories: ['개인', '배우자', '자녀', '가족'],
      hideTitle: true, titleFrom: ['company', 'product'],
      fields: [
        { key: 'company', label: '보험사', kind: 'text' },
        { key: 'insured', label: '피보험자', kind: 'text' },
        { key: 'product', label: '보험상품', kind: 'text' },
        { key: 'url', label: 'URL', kind: 'url' },
        { key: 'expiry', label: '만기일', kind: 'text' },
        { key: 'autoBank', label: '자동이체은행/카드', kind: 'text' },
        { key: 'autoAccount', label: '자동이체계좌/카드번호', kind: 'text' },
        { key: 'payDay', label: '결제일', kind: 'text' },
        { key: 'premium', label: '보험료', kind: 'text' },
      ]},
    { id: 'anniversary', label: '기념일', icon: 'cake',
      categories: ['가족', '친구', '업무'],
      fields: [
        { key: 'kind', label: '구분', kind: 'select', options: ['생일', '결혼기념일', '기일', '기타'] },
        { key: 'relation', label: '관계', kind: 'text' },
        { key: 'calendar', label: '양/음', kind: 'select', options: ['양력', '음력'] },
        { key: 'zodiac', label: '띠', kind: 'select', options: ZODIAC.slice().sort(), auto: 'zodiac' },
        { key: 'date', label: '생년월일', kind: 'yearly' },
      ]},
  ];
}

/* ---------- 주메뉴 구성 마이그레이션 (기존 데이터는 그대로 두고 필드 정의만 갱신) ---------- */
const F = {
  at(m, key) { return m.fields.findIndex(f => f.key === key); },
  ensure(m, def, beforeKey) {
    if (F.at(m, def.key) >= 0) return false;
    const i = beforeKey ? F.at(m, beforeKey) : -1;
    if (i >= 0) m.fields.splice(i, 0, def); else m.fields.push(def);
    return true;
  },
  after(m, def, afterKey) {
    if (F.at(m, def.key) >= 0) return false;
    const i = F.at(m, afterKey);
    if (i >= 0) m.fields.splice(i + 1, 0, def); else m.fields.push(def);
    return true;
  },
  move(m, key, afterKey) {
    const i = F.at(m, key); if (i < 0) return;
    const [f] = m.fields.splice(i, 1);
    const j = F.at(m, afterKey);
    if (j >= 0) m.fields.splice(j + 1, 0, f); else m.fields.push(f);
  },
  moveBefore(m, key, beforeKey) {
    const i = F.at(m, key), t = F.at(m, beforeKey);
    if (i < 0 || (t >= 0 && i < t)) return;   // 이미 앞에 있으면 그대로 둔다

    const [f] = m.fields.splice(i, 1);
    const j = F.at(m, beforeKey);
    if (j >= 0) m.fields.splice(j, 0, f); else m.fields.push(f);
  },
  label(m, key, label) { const f = m.fields[F.at(m, key)]; if (f) f.label = label; },
  kind(m, key, kind) { const f = m.fields[F.at(m, key)]; if (f) f.kind = kind; },
  remove(m, key) { const i = F.at(m, key); if (i >= 0) m.fields.splice(i, 1); },
};
/** "12/28", "2028-12" 같은 카드 만료 표기를 날짜 입력값으로 바꾼다 */
function normalizeCardExpiry(v) {
  const s = String(v || '').trim();
  if (!s || /^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  let m = /^(\d{1,2})\s*[\/.\-]\s*(\d{2,4})$/.exec(s);   // MM/YY, MM/YYYY
  let year, month;
  if (m) { month = Number(m[1]); year = Number(m[2]); }
  else {
    m = /^(\d{4})\s*[\/.\-]\s*(\d{1,2})$/.exec(s);        // YYYY-MM
    if (!m) return s;
    year = Number(m[1]); month = Number(m[2]);
  }
  if (year < 100) year += 2000;
  if (!(month >= 1 && month <= 12) || year < 1900 || year > 2999) return s;
  const last = new Date(year, month, 0).getDate();
  return `${year}-${String(month).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
}
/** 주메뉴 정의를 최신 사양으로 올린다. 레코드에 저장된 값은 건드리지 않는다. */
function migrateMenus(data) {
  const byId = id => data.menus.find(m => m.id === id);
  let m;
  if ((m = byId('login'))) {
    F.ensure(m, { key: 'email', label: 'e-Mail', kind: 'text' }, 'url');
  }
  if ((m = byId('bank'))) {
    F.after(m, { key: 'holder', label: '예금주', kind: 'text' }, 'bank');
    F.after(m, { key: 'autoTransfer', label: '자동이체 리스트', kind: 'memo' }, 'url');
  }
  if ((m = byId('card'))) {
    F.label(m, 'cardPassword', '카드비번');
    F.ensure(m, { key: 'billingBank', label: '결제은행', kind: 'text' }, 'billingAccount');
    F.after(m, { key: 'billingDay', label: '결제일', kind: 'text' }, 'billingAccount');
    F.kind(m, 'expiry', 'date');
    for (const r of data.records) {
      if (r.type === 'card' && r.fields && r.fields.expiry) r.fields.expiry = normalizeCardExpiry(r.fields.expiry);
    }
  }
  if ((m = byId('insurance'))) {
    m.categories ||= ['개인', '배우자', '자녀', '가족'];
    m.hideTitle = true; m.titleFrom = ['company', 'product'];
    F.kind(m, 'expiry', 'text');
    F.move(m, 'insured', 'company');
    F.ensure(m, { key: 'autoBank', label: '자동이체은행/카드', kind: 'text' }, 'premium');
    F.after(m, { key: 'autoAccount', label: '자동이체계좌/카드번호', kind: 'text' }, 'autoBank');
    F.after(m, { key: 'payDay', label: '결제일', kind: 'text' }, 'autoAccount');
  }
  if ((m = byId('anniversary'))) {
    m.categories ||= ['가족', '친구', '업무'];
    F.remove(m, 'name');
    F.label(m, 'date', '생년월일');
    F.moveBefore(m, 'calendar', 'date');
    F.after(m, { key: 'zodiac', label: '띠', kind: 'select', options: ZODIAC.slice().sort(), auto: 'zodiac' }, 'calendar');
  }
}

function parseYmd(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '').trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return isNaN(d) ? null : d;
}
function weekdayOf(ymd) { const d = parseYmd(ymd); return d ? WEEKDAYS[d.getDay()] + '요일' : ''; }
function zodiacOfYear(year) { return ZODIAC[((year % 12) + 12) % 12]; }
function zodiacOf(ymd) { const d = parseYmd(ymd); return d ? zodiacOfYear(d.getFullYear()) : ''; }
/** 생년월일 옆에 보여 줄 안내 (양력이면 요일, 음력이면 음력 표시) */
function dateHint(ymd, calendar) {
  const d = parseYmd(ymd); if (!d) return '';
  const base = `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
  if (calendar === '음력') return `${base} (음력)`;
  return `${base} ${WEEKDAYS[d.getDay()]}요일`;
}
/** 날짜 입력값의 연도를 4자리 범위로 맞춘다 (6자리 연도 입력 방지) */
/** 날짜 문자열의 연도를 4자리 범위(1900~2999)로 맞춘다. 바꿀 것이 없으면 null */
function clampYmd(value) {
  const m = /^(\d+)-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!m) return null;
  const y = Number(m[1]);
  if (y >= 1900 && y <= 2999) return null;
  const fixed = Math.min(2999, Math.max(1900, y));
  return `${String(fixed).padStart(4, '0')}-${m[2]}-${m[3]}`;
}
/** 제목을 숨긴 주메뉴는 지정한 항목들로 제목을 만든다 */
function composeTitle(menu, fields, fallback) {
  if (!menu || !menu.hideTitle) return fallback;
  const parts = (menu.titleFrom || []).map(k => (fields[k] || '').trim()).filter(Boolean);
  return parts.join(' · ') || fallback || menu.label;
}
function menuOf(id) { return menus().find(m => m.id === id) || null; }
function fieldsOf(id) { const m = menuOf(id); return m ? m.fields : []; }
function isSecret(type, key) { const f = fieldsOf(type).find(x => x.key === key); return !!(f && f.kind === 'secret'); }

if (typeof module !== 'undefined') module.exports = {
  FIELD_KINDS, MENU_VERSION, ZODIAC, WEEKDAYS, DATE_MIN, DATE_MAX,
  defaultMenus, migrateMenus, normalizeCardExpiry, parseYmd, weekdayOf,
  zodiacOfYear, zodiacOf, dateHint, clampYmd, composeTitle, F,
};

'use strict';
const test = require('node:test');
const assert = require('node:assert');
const M = require('../renderer/menus.js');

/** 1.0.0 시절의 주메뉴 구성 (마이그레이션 출발점) */
function v1Menus() {
  return [
    { id: 'login', label: '시스템로그인', icon: 'key', fields: [
      { key: 'username', label: 'ID', kind: 'text' }, { key: 'password', label: 'Pass', kind: 'secret' },
      { key: 'url', label: 'URL', kind: 'url' }, { key: 'ip', label: 'IP', kind: 'text' }]},
    { id: 'bank', label: '뱅킹', icon: 'bank', fields: [
      { key: 'bank', label: '은행명', kind: 'text' }, { key: 'accountNumber', label: '계좌번호', kind: 'text' },
      { key: 'username', label: 'ID', kind: 'text' }, { key: 'password', label: 'Pass', kind: 'secret' },
      { key: 'url', label: 'URL', kind: 'url' }]},
    { id: 'card', label: '크레디트카드', icon: 'card', fields: [
      { key: 'cardName', label: '카드명', kind: 'text' }, { key: 'cardNumber', label: '카드번호', kind: 'secret' },
      { key: 'expiry', label: '만료일', kind: 'text' }, { key: 'pin', label: 'PIN', kind: 'secret' },
      { key: 'cardPassword', label: 'Pass (카드)', kind: 'secret' }, { key: 'billingAccount', label: '결제계좌', kind: 'text' },
      { key: 'url', label: 'URL', kind: 'url' }, { key: 'username', label: 'ID', kind: 'text' },
      { key: 'password', label: 'Pass (로그인)', kind: 'secret' }]},
    { id: 'insurance', label: '보험', icon: 'shield', fields: [
      { key: 'company', label: '보험사', kind: 'text' }, { key: 'product', label: '보험상품', kind: 'text' },
      { key: 'url', label: 'URL', kind: 'url' }, { key: 'expiry', label: '만기일', kind: 'date' },
      { key: 'premium', label: '보험료', kind: 'text' }, { key: 'insured', label: '피보험자', kind: 'text' }]},
    { id: 'anniversary', label: '기념일', icon: 'cake', fields: [
      { key: 'kind', label: '구분', kind: 'select', options: ['생일', '결혼기념일', '기일', '기타'] },
      { key: 'name', label: '이름', kind: 'text' }, { key: 'relation', label: '관계', kind: 'text' },
      { key: 'date', label: '날짜', kind: 'yearly' }, { key: 'calendar', label: '양/음', kind: 'select', options: ['양력', '음력'] }]},
  ];
}
function oldVault() {
  return {
    menus: v1Menus(), categories: ['개인', '업무', '금융'],
    records: [
      { id: 'a', type: 'login', title: '그룹웨어', category: '업무', notes: '메모', fields: { username: 'marco', password: 'pw', url: 'https://x.kr', ip: '10.0.0.1' } },
      { id: 'b', type: 'card', title: '국민카드', category: '금융', fields: { cardName: 'KB', cardNumber: '1111', expiry: '12/28', pin: '1234', cardPassword: 'cpw', billingAccount: '123-45' } },
      { id: 'c', type: 'insurance', title: '자동차보험', category: '금융', fields: { company: '삼성화재', product: '애니카', expiry: '2027-01-31', premium: '65000', insured: '본인' } },
      { id: 'd', type: 'anniversary', title: '어머니 생신', category: '개인', fields: { kind: '생일', name: '김영희', relation: '어머니', date: '1960-03-15', calendar: '음력' } },
    ],
  };
}
const keys = m => m.fields.map(f => f.key);
const byId = (d, id) => d.menus.find(m => m.id === id);

test('시스템로그인: URL 위에 e-Mail 추가', () => {
  const d = oldVault(); M.migrateMenus(d);
  assert.deepStrictEqual(keys(byId(d, 'login')), ['username', 'password', 'email', 'url', 'ip']);
});

test('뱅킹: 은행명 아래 예금주, URL 아래 자동이체 리스트(메모)', () => {
  const d = oldVault(); M.migrateMenus(d);
  const m = byId(d, 'bank');
  assert.deepStrictEqual(keys(m), ['bank', 'holder', 'accountNumber', 'username', 'password', 'url', 'autoTransfer']);
  assert.strictEqual(m.fields.find(f => f.key === 'autoTransfer').kind, 'memo');
  assert.strictEqual(m.fields.find(f => f.key === 'holder').label, '예금주');
});

test('크레디트카드: 카드비번 이름 변경, 결제은행·결제일 추가, 만료일 달력화', () => {
  const d = oldVault(); M.migrateMenus(d);
  const m = byId(d, 'card');
  assert.deepStrictEqual(keys(m), ['cardName', 'cardNumber', 'expiry', 'pin', 'cardPassword', 'billingBank', 'billingAccount', 'billingDay', 'url', 'username', 'password']);
  assert.strictEqual(m.fields.find(f => f.key === 'cardPassword').label, '카드비번');
  assert.strictEqual(m.fields.find(f => f.key === 'expiry').kind, 'date');
  // 기존 "12/28" 값은 날짜 형식으로 바뀌어 보존된다
  assert.strictEqual(d.records.find(r => r.id === 'b').fields.expiry, '2028-12-31');
});

test('보험: 카테고리·제목 숨김·항목 순서와 자동이체 항목', () => {
  const d = oldVault(); M.migrateMenus(d);
  const m = byId(d, 'insurance');
  assert.deepStrictEqual(m.categories, ['개인', '배우자', '자녀', '가족']);
  assert.strictEqual(m.hideTitle, true);
  assert.deepStrictEqual(m.titleFrom, ['company', 'product']);
  assert.strictEqual(m.fields.find(f => f.key === 'expiry').kind, 'text');
  assert.deepStrictEqual(keys(m), ['company', 'insured', 'product', 'url', 'expiry', 'autoBank', 'autoAccount', 'payDay', 'premium']);
});

test('기념일: 이름 삭제, 생년월일로 이름 변경, 양/음 다음에 띠', () => {
  const d = oldVault(); M.migrateMenus(d);
  const m = byId(d, 'anniversary');
  assert.deepStrictEqual(m.categories, ['가족', '친구', '업무']);
  assert.deepStrictEqual(keys(m), ['kind', 'relation', 'calendar', 'zodiac', 'date']);
  assert.strictEqual(m.fields.find(f => f.key === 'date').label, '생년월일');
  assert.strictEqual(m.fields.find(f => f.key === 'zodiac').auto, 'zodiac');
});

test('마이그레이션이 기존 입력값을 지우지 않는다', () => {
  const d = oldVault(); const before = JSON.parse(JSON.stringify(d.records));
  M.migrateMenus(d);
  for (const r of before) {
    const now = d.records.find(x => x.id === r.id);
    assert.strictEqual(now.title, r.title);
    assert.strictEqual(now.category, r.category);
    for (const [k, v] of Object.entries(r.fields)) {
      if (r.id === 'b' && k === 'expiry') continue;      // 표기만 날짜 형식으로 바뀜
      assert.strictEqual(now.fields[k], v, `${r.id}.${k}`);
    }
  }
});

test('두 번 실행해도 결과가 같다', () => {
  const a = oldVault(); M.migrateMenus(a);
  const b = oldVault(); M.migrateMenus(b); M.migrateMenus(b);
  assert.deepStrictEqual(b.menus, a.menus);
});

test('새 볼트의 기본 구성이 마이그레이션 결과와 일치한다', () => {
  const d = oldVault(); M.migrateMenus(d);
  const fresh = M.defaultMenus();
  for (const m of fresh) {
    const got = byId(d, m.id);
    assert.deepStrictEqual(keys(got), m.fields.map(f => f.key), m.label);
    assert.deepStrictEqual(got.fields.map(f => f.label), m.fields.map(f => f.label), m.label + ' 이름');
    assert.deepStrictEqual(got.fields.map(f => f.kind), m.fields.map(f => f.kind), m.label + ' 형식');
    assert.deepStrictEqual(got.categories, m.categories, m.label + ' 카테고리');
  }
});

test('띠 계산', () => {
  assert.strictEqual(M.zodiacOfYear(1960), '쥐');
  assert.strictEqual(M.zodiacOfYear(2020), '쥐');
  assert.strictEqual(M.zodiacOfYear(2026), '말');
  assert.strictEqual(M.zodiacOf('1988-05-02'), '용');
  assert.strictEqual(M.zodiacOf(''), '');
});

test('요일 안내: 양력은 요일, 음력은 음력 표기', () => {
  assert.strictEqual(M.dateHint('1960-03-15', '양력'), '1960년 3월 15일 화요일');
  assert.strictEqual(M.dateHint('1960-03-15', '음력'), '1960년 3월 15일 (음력)');
  assert.strictEqual(M.dateHint('', '양력'), '');
});

test('카드 만료일 표기 변환', () => {
  assert.strictEqual(M.normalizeCardExpiry('12/28'), '2028-12-31');
  assert.strictEqual(M.normalizeCardExpiry('3/27'), '2027-03-31');
  assert.strictEqual(M.normalizeCardExpiry('02/28'), '2028-02-29');
  assert.strictEqual(M.normalizeCardExpiry('2028-12'), '2028-12-31');
  assert.strictEqual(M.normalizeCardExpiry('2028-12-05'), '2028-12-05');
  assert.strictEqual(M.normalizeCardExpiry('없음'), '없음');
  assert.strictEqual(M.normalizeCardExpiry(''), '');
});

test('연도 6자리 입력은 4자리로 교정한다', () => {
  assert.strictEqual(M.clampYmd('123456-03-15'), '2999-03-15');
  assert.strictEqual(M.clampYmd('0002-03-15'), '1900-03-15');
  assert.strictEqual(M.clampYmd('2026-03-15'), null);
  assert.strictEqual(M.clampYmd(''), null);
});

test('제목을 숨긴 주메뉴는 지정 항목으로 제목을 만든다', () => {
  const ins = M.defaultMenus().find(m => m.id === 'insurance');
  assert.strictEqual(M.composeTitle(ins, { company: '삼성화재', product: '애니카' }, ''), '삼성화재 · 애니카');
  assert.strictEqual(M.composeTitle(ins, { company: '삼성화재' }, ''), '삼성화재');
  assert.strictEqual(M.composeTitle(ins, {}, ''), '보험');
  const login = M.defaultMenus().find(m => m.id === 'login');
  assert.strictEqual(M.composeTitle(login, {}, '내가 쓴 제목'), '내가 쓴 제목');
});

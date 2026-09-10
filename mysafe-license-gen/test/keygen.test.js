'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { generateLicense, addMonths, PUBLIC_KEY_HEX } = require('../src/keygen');
const { verifyLicense, PUBLIC_KEY_HEX: APP_PUB } = require('../../mysafe/src/license');

test('발급기와 앱의 공개키가 같다', () => assert.strictEqual(PUBLIC_KEY_HEX, APP_PUB));

test('영구 라이선스', () => {
  const r = generateLicense('홍길동', 'perpetual');
  assert.strictEqual(r.typeLabel, '영구');
  assert.strictEqual(r.expires, '');
  const v = verifyLicense('홍길동', r.key);
  assert.strictEqual(v.ok, true);
  assert.strictEqual(v.type, 0);
  assert.strictEqual(v.typeLabel, '영구');
  assert.strictEqual(v.expires, null);
  assert.strictEqual(v.expired, false);
  assert.strictEqual(v.daysLeft, null);
  // 대소문자·연속 공백 차이는 허용
  assert.strictEqual(verifyLicense('  홍길동 ', r.key).ok, true);
});

test('체험판은 기본 1개월 만료', () => {
  const r = generateLicense('IT Brain', 'trial');
  assert.strictEqual(r.typeLabel, '체험판');
  assert.strictEqual(r.expires, addMonths(1));
  const v = verifyLicense('it brain', r.key);
  assert.strictEqual(v.ok, true);
  assert.strictEqual(v.type, 1);
  assert.strictEqual(v.typeLabel, '체험판');
  assert.strictEqual(v.expires, addMonths(1));
  assert.strictEqual(v.expired, false);
  assert.ok(v.daysLeft >= 27 && v.daysLeft <= 32, '남은 일수 ' + v.daysLeft);
});

test('만료된 체험판은 expired', () => {
  const r = generateLicense('만료테스트', 'trial', '2020-01-01');
  const v = verifyLicense('만료테스트', r.key);
  assert.strictEqual(v.ok, true);
  assert.strictEqual(v.expired, true);
  assert.ok(v.daysLeft < 0);
});

test('체험판 키와 영구 키는 서로 다르고 종류가 섞이지 않는다', () => {
  const t = generateLicense('같은사람', 'trial', '2030-01-01');
  const p = generateLicense('같은사람', 'perpetual');
  assert.notStrictEqual(t.key, p.key);
  assert.strictEqual(verifyLicense('같은사람', t.key).type, 1);
  assert.strictEqual(verifyLicense('같은사람', p.key).type, 0);
});

test('다른 사용자명이나 변조된 키는 거부', () => {
  const { key } = generateLicense('A사용자', 'perpetual');
  assert.strictEqual(verifyLicense('B사용자', key).ok, false);
  const i = 40;
  const tampered = key.slice(0, i) + (key[i] === 'A' ? 'B' : 'A') + key.slice(i + 1);
  assert.strictEqual(verifyLicense('A사용자', tampered).ok, false);
  assert.strictEqual(verifyLicense('A사용자', 'XXXX').ok, false);
  assert.strictEqual(verifyLicense('', key).ok, false);
});

test('말일 보정 (1개월 더하기)', () => {
  assert.match(addMonths(1), /^\d{4}-\d{2}-\d{2}$/);
});

test('발급기 비밀번호 해시 검증', () => {
  const auth = require('../src/auth');
  const rec = auth.makeRecord('secret123');
  assert.strictEqual(auth.verify('secret123', rec), true);
  assert.strictEqual(auth.verify('wrong', rec), false);
  assert.strictEqual(auth.verify('secret123', null), false);
  assert.throws(() => auth.makeRecord('ab'), /4자/);
  // 같은 비밀번호라도 salt가 달라 해시는 매번 다르다
  assert.notStrictEqual(rec.hash, auth.makeRecord('secret123').hash);
});

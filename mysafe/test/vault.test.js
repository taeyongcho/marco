'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Vault } = require('../src/vault');
const { toCsv, fromCsv } = require('../src/csv');

function tmpVault() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mv-'));
  return new Vault(path.join(dir, 'vault.mv'));
}

test('create → lock → unlock 왕복', () => {
  const v = tmpVault();
  assert.strictEqual(v.exists(), false);
  const data = v.create('correct horse battery');
  data.records.push({ id: '1', type: 'login', title: '네이버', fields: { username: 'me', password: 'p@ss' } });
  v.save(data);
  v.lock();
  assert.strictEqual(v.isUnlocked(), false);
  const back = v.unlock('correct horse battery');
  assert.strictEqual(back.records[0].title, '네이버');
  assert.strictEqual(back.records[0].fields.password, 'p@ss');
});

test('잘못된 비밀번호는 거부', () => {
  const v = tmpVault();
  v.create('correct horse battery');
  v.lock();
  assert.throws(() => v.unlock('wrong password!'), /올바르지 않습니다/);
  assert.strictEqual(v.isUnlocked(), false);
});

test('짧은 비밀번호 거부, 중복 생성 거부', () => {
  const v = tmpVault();
  assert.throws(() => v.create('short'), /8자/);
  v.create('long enough pw');
  assert.throws(() => v.create('long enough pw'), /이미/);
});

test('파일에는 평문이 남지 않는다', () => {
  const v = tmpVault();
  const data = v.create('correct horse battery');
  data.records.push({ id: '1', type: 'login', title: 'SECRET-TITLE', fields: { password: 'SECRET-PW' } });
  v.save(data);
  const raw = fs.readFileSync(v.filePath, 'utf8');
  assert.ok(!raw.includes('SECRET-TITLE'));
  assert.ok(!raw.includes('SECRET-PW'));
  const parsed = JSON.parse(raw);
  assert.strictEqual(parsed.kdf.name, 'scrypt');
});

test('마스터 비밀번호 변경', () => {
  const v = tmpVault();
  const data = v.create('old password 1');
  assert.throws(() => v.changePassword('bad', 'new password 2', data), /현재/);
  v.changePassword('old password 1', 'new password 2', data);
  v.lock();
  assert.throws(() => v.unlock('old password 1'));
  assert.ok(v.unlock('new password 2'));
});

test('CSV 왕복 (따옴표, 줄바꿈, 한글, 추가 필드)', () => {
  const recs = [
    { type: 'login', title: '사이트 "A"', category: '개인', notes: '줄1\n줄2', fields: { url: 'https://a.kr', username: 'u,1', password: 'p"w' } },
    { type: 'card', title: '카드', category: '', notes: '', fields: { cardNumber: '1234', cvv: '999' } },
  ];
  const csv = toCsv(recs);
  assert.ok(csv.startsWith('﻿'));
  const back = fromCsv(csv);
  assert.strictEqual(back.length, 2);
  assert.deepStrictEqual(back[0].fields, recs[0].fields);
  assert.strictEqual(back[0].notes, '줄1\n줄2');
  assert.strictEqual(back[0].title, '사이트 "A"');
  assert.deepStrictEqual(back[1].fields, { cardNumber: '1234', cvv: '999' });
});

test('CSV 외부 형식 (name/username/password 헤더)', () => {
  const back = fromCsv('name,url,username,password\nGoogle,https://google.com,me@x.com,secret\n');
  assert.strictEqual(back[0].title, 'Google');
  assert.strictEqual(back[0].type, 'login');
  assert.strictEqual(back[0].fields.password, 'secret');
});

/* ---------- 시스템 날짜 되돌림 감지 ---------- */
const clock = require('../src/clock');
const { verifyLicense } = require('../src/license');

const TAG = '/test/userdata';
const H = 3600000, D = 86400000;

test('정상 진행 시에는 통과하고 기록이 갱신된다', () => {
  const t0 = Date.now();
  const a = clock.checkClock({ now: t0, configRecord: undefined, tag: TAG });
  assert.strictEqual(a.ok, true);
  assert.strictEqual(a.nextSeen, t0);
  const b = clock.checkClock({ now: t0 + D, configRecord: a.record, tag: TAG });
  assert.strictEqual(b.ok, true);
  assert.strictEqual(b.nextSeen, t0 + D);
});

test('시계를 뒤로 돌리면 감지한다', () => {
  const t0 = Date.now();
  const a = clock.checkClock({ now: t0, configRecord: undefined, tag: TAG });
  const back = clock.checkClock({ now: t0 - 40 * D, configRecord: a.record, tag: TAG });
  assert.strictEqual(back.ok, false);
  assert.strictEqual(back.reason, 'rollback');
  assert.strictEqual(back.seen, t0);
  assert.strictEqual(back.effectiveNow, t0, '만료 판정은 되돌리기 전 시각 기준');
  // 되돌린 상태에서도 마지막으로 본 시각은 보존된다
  assert.strictEqual(back.nextSeen, t0);
});

test('소폭 역행(시각 동기화 등)은 허용한다', () => {
  const t0 = Date.now();
  const a = clock.checkClock({ now: t0, configRecord: undefined, tag: TAG });
  const drift = clock.checkClock({ now: t0 - 60000, configRecord: a.record, tag: TAG });
  assert.strictEqual(drift.ok, true);
  assert.strictEqual(drift.effectiveNow, t0);
});

test('기록을 고치면 변조로 잡는다', () => {
  const t0 = Date.now();
  const a = clock.checkClock({ now: t0, configRecord: undefined, tag: TAG });
  const forged = { ...a.record, seen: t0 - 40 * D };
  const r = clock.checkClock({ now: t0 - 40 * D, configRecord: forged, tag: TAG });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'tampered');
  // 다른 설치본의 기록을 가져다 붙여도 태그가 달라 걸린다
  const other = clock.checkClock({ now: t0, configRecord: undefined, tag: '/other' });
  assert.strictEqual(clock.checkClock({ now: t0, configRecord: other.record, tag: TAG }).reason, 'tampered');
});

test('config를 지워도 다른 저장소 기록으로 감지한다', () => {
  const t0 = Date.now();
  const r = clock.checkClock({ now: t0 - 40 * D, configRecord: undefined, stateSeen: t0, tag: TAG });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'rollback');
  const v = clock.checkClock({ now: t0 - 40 * D, configRecord: undefined, vaultSeen: t0, tag: TAG });
  assert.strictEqual(v.reason, 'rollback');
});

test('되돌린 시각이 아니라 마지막으로 본 날짜로 만료를 판정한다', () => {
  const { generateLicense } = require('../../mysafe-license-gen/src/keygen');
  const { key } = generateLicense('시계테스트', 'trial', '2026-03-01');
  // 시계를 만료 전으로 되돌려도, 마지막으로 본 날짜가 만료 뒤라면 만료로 판정한다
  assert.strictEqual(verifyLicense('시계테스트', key, '2026-02-01').expired, false);
  assert.strictEqual(verifyLicense('시계테스트', key, '2026-04-01').expired, true);
  const rolled = clock.checkClock({
    now: Date.UTC(2026, 1, 1), configRecord: undefined, stateSeen: Date.UTC(2026, 3, 1), tag: TAG,
  });
  assert.strictEqual(rolled.reason, 'rollback');
  assert.strictEqual(verifyLicense('시계테스트', key, clock.ymd(rolled.effectiveNow)).expired, true);
});

test('ymd는 로컬 날짜 문자열을 만든다', () => {
  const d = new Date(2026, 8, 10, 15, 30);
  assert.strictEqual(clock.ymd(d.getTime()), '2026-09-10');
});

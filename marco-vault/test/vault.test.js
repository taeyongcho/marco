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

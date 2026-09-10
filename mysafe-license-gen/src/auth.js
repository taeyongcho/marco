'use strict';
// 발급기 접근 비밀번호. scrypt 해시만 저장하며, 비밀번호 자체는 어디에도 남지 않는다.
const crypto = require('crypto');

const KDF = { N: 1 << 15, r: 8, p: 1, keyLen: 32 };
const DEFAULT_PASSWORD = 'itbrain';   // 최초 실행 시 기본 비밀번호 (첫 로그인 후 변경 권장)
const MIN_LEN = 4;

function hash(password, salt) {
  return crypto.scryptSync(Buffer.from(String(password), 'utf8'), salt, KDF.keyLen, {
    N: KDF.N, r: KDF.r, p: KDF.p, maxmem: 128 * KDF.N * KDF.r * 2,
  });
}
function makeRecord(password) {
  if (String(password).length < MIN_LEN) throw new Error(`비밀번호는 ${MIN_LEN}자 이상이어야 합니다.`);
  const salt = crypto.randomBytes(16);
  return { salt: salt.toString('base64'), hash: hash(password, salt).toString('base64'), N: KDF.N, r: KDF.r, p: KDF.p };
}
function verify(password, rec) {
  if (!rec || !rec.salt || !rec.hash) return false;
  const salt = Buffer.from(rec.salt, 'base64');
  const expect = Buffer.from(rec.hash, 'base64');
  const got = crypto.scryptSync(Buffer.from(String(password), 'utf8'), salt, expect.length, {
    N: rec.N || KDF.N, r: rec.r || KDF.r, p: rec.p || KDF.p, maxmem: 128 * (rec.N || KDF.N) * (rec.r || KDF.r) * 2,
  });
  return got.length === expect.length && crypto.timingSafeEqual(got, expect);
}

module.exports = { makeRecord, verify, DEFAULT_PASSWORD, MIN_LEN };

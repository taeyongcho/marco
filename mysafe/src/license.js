'use strict';
// 라이선스 검증 (Ed25519 전자서명). 앱에는 공개키만 포함되며, 발급은 IT Brain Co., Ltd.의 발급기(비밀키)로만 가능.
const crypto = require('crypto');

const PUBLIC_KEY_HEX = '067b47bb0ea79acf2da4e744f38bc3b638ee9f586317dca5d313b7ea7f196066';
const KEY_PREFIX = 'MySafe|v1|';
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const EPOCH = Date.UTC(2000, 0, 1);

function normalizeUser(s) { return String(s || '').trim().replace(/\s+/g, ' ').toLowerCase(); }
const TYPES = { 0: '영구', 1: '체험판' };

function base32Decode(str) {
  const clean = String(str || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
  const out = []; let bits = 0, value = 0;
  for (const ch of clean) {
    value = (value << 5) | B32.indexOf(ch); bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(out);
}

function publicKey() {
  // SPKI DER 헤더 + 32바이트 공개키
  const der = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(PUBLIC_KEY_HEX, 'hex')]);
  return crypto.createPublicKey({ key: der, format: 'der', type: 'spki' });
}

function expiryFromDays(days) {
  if (!days) return null;
  return new Date(EPOCH + days * 86400000).toISOString().slice(0, 10);
}

function daysLeft(expires, todayYmd) {
  if (!expires) return null;
  const [ty, tm, td] = todayYmd.split('-').map(Number);
  const [y, m, d] = expires.split('-').map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(ty, tm - 1, td)) / 86400000);
}
function todayLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** @returns {{ok:boolean, user?:string, type?:number, typeLabel?:string, expires?:string|null, expired?:boolean, daysLeft?:number|null, error?:string}} */
function verifyLicense(user, key, today) {
  const todayYmd = today || todayLocal();
  const norm = normalizeUser(user);
  if (!norm) return { ok: false, error: '사용자명을 입력하세요.' };
  const bytes = base32Decode(key);
  if (bytes.length !== 68 || bytes[0] !== 2) return { ok: false, error: '라이선스 키 형식이 올바르지 않습니다.' };
  const type = bytes[1];
  const expDays = (bytes[2] << 8) | bytes[3];
  const sig = bytes.subarray(4);
  const msg = Buffer.from(KEY_PREFIX + norm + '|' + type + '|' + expDays, 'utf8');
  let valid = false;
  try { valid = crypto.verify(null, msg, publicKey(), sig); } catch (_) { valid = false; }
  if (!valid) return { ok: false, error: '라이선스 키가 사용자명과 일치하지 않습니다.' };
  const expires = expiryFromDays(expDays);
  const expired = !!expires && expires < todayYmd;
  return {
    ok: true, user: String(user).trim().replace(/\s+/g, ' '),
    type, typeLabel: TYPES[type] || '기타', expires, expired, daysLeft: daysLeft(expires, todayYmd),
  };
}

module.exports = { verifyLicense, normalizeUser, base32Decode, todayLocal, TYPES, PUBLIC_KEY_HEX };

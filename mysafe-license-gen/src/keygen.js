'use strict';
// 라이선스 키 생성 (Ed25519 비밀키). 이 파일과 발급기 exe는 IT Brain Co., Ltd. 내부에서만 보관하세요.
const crypto = require('crypto');

const PRIVATE_KEY_HEX = '70dff0a3c99525dfb901bc61b25c8c275a4bb816d671f5bc29489aa4b1b2c0ec';
const PUBLIC_KEY_HEX = '067b47bb0ea79acf2da4e744f38bc3b638ee9f586317dca5d313b7ea7f196066';
const KEY_PREFIX = 'MySafe|v1|';
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const EPOCH = Date.UTC(2000, 0, 1);

function normalizeUser(s) { return String(s || '').trim().replace(/\s+/g, ' ').toLowerCase(); }
const TYPE_PERPETUAL = 0;   // 영구
const TYPE_TRIAL = 1;       // 체험판

function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const b of buf) {
    value = (value << 8) | b; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
function group(s, n = 6) { return s.match(new RegExp('.{1,' + n + '}', 'g')).join('-'); }

function privateKey() {
  const der = Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(PRIVATE_KEY_HEX, 'hex')]);
  return crypto.createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
}
function daysFromDate(ymd) {
  if (!ymd) return 0;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd); if (!m) throw new Error('만료일은 YYYY-MM-DD 형식이어야 합니다.');
  const d = Math.round((Date.UTC(+m[1], +m[2] - 1, +m[3]) - EPOCH) / 86400000);
  if (d <= 0 || d > 65535) throw new Error('만료일 범위를 벗어났습니다.');
  return d;
}

function addMonths(months) {
  const d = new Date(); d.setHours(0, 0, 0, 0);
  const day = d.getDate();
  d.setMonth(d.getMonth() + months);
  if (d.getDate() !== day) d.setDate(0);   // 말일 보정 (예: 1/31 + 1개월 → 2/28)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * 라이선스 키 생성
 * @param {string} user  사용자명 (등록 시 그대로 입력해야 함)
 * @param {'trial'|'perpetual'} kind  체험판(1개월) 또는 영구
 * @param {string} [expires]  체험판일 때 만료일 직접 지정 (비우면 오늘부터 1개월)
 */
function generateLicense(user, kind, expires) {
  const norm = normalizeUser(user);
  if (!norm) throw new Error('사용자명을 입력하세요.');
  const trial = kind !== 'perpetual';
  const type = trial ? TYPE_TRIAL : TYPE_PERPETUAL;
  const expiryDate = trial ? (expires || addMonths(1)) : '';
  const expDays = daysFromDate(expiryDate);
  if (trial && !expDays) throw new Error('체험판은 만료일이 필요합니다.');
  const msg = Buffer.from(KEY_PREFIX + norm + '|' + type + '|' + expDays, 'utf8');
  const sig = crypto.sign(null, msg, privateKey());
  const bytes = Buffer.concat([Buffer.from([2, type, (expDays >> 8) & 0xff, expDays & 0xff]), sig]);
  return { key: group(base32Encode(bytes)), type, typeLabel: trial ? '체험판' : '영구', expires: expiryDate };
}

module.exports = { generateLicense, normalizeUser, addMonths, PUBLIC_KEY_HEX };

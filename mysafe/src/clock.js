'use strict';
// 시스템 날짜 되돌림 감지.
// 앱이 실행될 때마다 "지금까지 본 가장 늦은 시각"을 서명(HMAC)해서 여러 곳에 기록해 두고,
// 현재 시각이 그보다 크게 뒤로 가 있으면 시계를 되돌린 것으로 본다.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SECRET = Buffer.from('a7f3c19e5b8d24610fe93b7c5a2d84196cb0e7f31d5a9284c6b3f07e15da8c92', 'hex');
const TOLERANCE_MS = 10 * 60 * 1000;   // NTP 보정 등 정상적인 소폭 역행은 허용
const STATE_FILE = '.mvstate';

function mac(seen, tag) {
  return crypto.createHmac('sha256', SECRET).update(`${seen}|${tag}`).digest('base64');
}
function packRecord(seen, tag) { return { seen, tag, mac: mac(seen, tag) }; }
/** 서명이 맞는 기록이면 시각(ms)을, 아니면 null (변조·손상) */
function unpackRecord(rec, tag) {
  if (!rec || typeof rec.seen !== 'number' || rec.tag !== tag || typeof rec.mac !== 'string') return null;
  const expect = Buffer.from(mac(rec.seen, tag), 'utf8');
  const got = Buffer.from(rec.mac, 'utf8');
  if (got.length !== expect.length || !crypto.timingSafeEqual(got, expect)) return null;
  return rec.seen;
}

function statePath(userDataDir) { return path.join(userDataDir, STATE_FILE); }
function readState(userDataDir, tag) {
  try { return unpackRecord(JSON.parse(fs.readFileSync(statePath(userDataDir), 'utf8')), tag); } catch (_) { return undefined; }
}
function writeState(userDataDir, seen, tag) {
  try {
    fs.mkdirSync(userDataDir, { recursive: true });
    fs.writeFileSync(statePath(userDataDir), JSON.stringify(packRecord(seen, tag)), 'utf8');
  } catch (_) { /* 쓰기 실패는 무시 */ }
}

/**
 * 시계 상태를 확인하고 기록을 갱신한다.
 * @param {object} opts
 * @param {number} opts.now            현재 시각 (ms)
 * @param {object|undefined} opts.configRecord  config.json에 저장된 기록
 * @param {number|undefined} opts.vaultSeen     볼트 안에 저장된 시각 (잠금 해제 후에만 알 수 있음)
 * @param {string} opts.tag            설치 구분용 태그 (보통 userData 경로)
 * @param {number|undefined} opts.stateSeen     별도 상태 파일의 시각
 * @returns {{ok:boolean, reason?:'rollback'|'tampered', seen:number, effectiveNow:number, backMs:number, record:object}}
 */
function checkClock({ now, configRecord, vaultSeen, stateSeen, tag }) {
  const fromConfig = unpackRecord(configRecord, tag);
  const tampered = configRecord !== undefined && fromConfig === null;
  const candidates = [fromConfig, stateSeen, vaultSeen].filter(v => typeof v === 'number' && v > 0);
  const seen = candidates.length ? Math.max(...candidates) : 0;
  const backMs = seen - now;
  const rolledBack = seen > 0 && backMs > TOLERANCE_MS;
  const effectiveNow = Math.max(now, seen);   // 만료 판정은 항상 "본 적 있는 가장 늦은 시각" 기준
  const next = Math.max(seen, now);
  return {
    ok: !rolledBack && !tampered,
    reason: rolledBack ? 'rollback' : (tampered ? 'tampered' : undefined),
    seen, effectiveNow, backMs, record: packRecord(next, tag), nextSeen: next,
  };
}

function ymd(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

module.exports = { checkClock, packRecord, unpackRecord, readState, writeState, ymd, TOLERANCE_MS, STATE_FILE };

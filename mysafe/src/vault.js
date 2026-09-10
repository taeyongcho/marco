'use strict';
// 볼트 파일 암호화/복호화 모듈.
// 형식: JSON { version, kdf:{name,salt,N,r,p}, iv, tag, data }  (모두 base64)
// 키 유도: scrypt(마스터 비밀번호, salt) -> 32바이트
// 암호화: AES-256-GCM

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const KDF = { name: 'scrypt', N: 1 << 15, r: 8, p: 1, keyLen: 32 };
const FILE_VERSION = 1;

function deriveKey(password, salt, params = KDF) {
  return crypto.scryptSync(Buffer.from(password, 'utf8'), salt, params.keyLen, {
    N: params.N, r: params.r, p: params.p, maxmem: 128 * params.N * params.r * 2,
  });
}

function encrypt(key, plaintextObj) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(plaintextObj), 'utf8');
  const data = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { iv, tag: cipher.getAuthTag(), data };
}

function decrypt(key, iv, tag, data) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(data), decipher.final()]);
  return JSON.parse(plain.toString('utf8'));
}

function emptyVault() {
  return {
    records: [],
    categories: ['개인', '업무', '금융', '쇼핑'],
    settings: { autoLockMinutes: 5, clipboardClearSeconds: 30 },
  };
}

class Vault {
  constructor(filePath) {
    this.filePath = filePath;
    this.key = null;      // 잠금 해제 상태에서만 메모리에 보관
    this.salt = null;
    this.kdf = null;
  }

  exists() {
    return fs.existsSync(this.filePath);
  }

  isUnlocked() {
    return this.key !== null;
  }

  /** 새 볼트 생성. 기존 파일이 있으면 오류. */
  create(masterPassword) {
    if (this.exists()) throw new Error('이미 볼트 파일이 있습니다.');
    if (!masterPassword || masterPassword.length < 8) {
      throw new Error('마스터 비밀번호는 8자 이상이어야 합니다.');
    }
    this.salt = crypto.randomBytes(16);
    this.kdf = { ...KDF };
    this.key = deriveKey(masterPassword, this.salt, this.kdf);
    const data = emptyVault();
    this._write(data);
    return data;
  }

  /** 마스터 비밀번호로 잠금 해제. 실패 시 예외. */
  unlock(masterPassword) {
    const file = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
    if (file.version !== FILE_VERSION) throw new Error('지원하지 않는 볼트 파일 버전입니다.');
    const salt = Buffer.from(file.kdf.salt, 'base64');
    const kdf = { ...KDF, N: file.kdf.N, r: file.kdf.r, p: file.kdf.p };
    const key = deriveKey(masterPassword, salt, kdf);
    let data;
    try {
      data = decrypt(key,
        Buffer.from(file.iv, 'base64'),
        Buffer.from(file.tag, 'base64'),
        Buffer.from(file.data, 'base64'));
    } catch (e) {
      throw new Error('마스터 비밀번호가 올바르지 않습니다.');
    }
    this.key = key;
    this.salt = salt;
    this.kdf = kdf;
    return data;
  }

  lock() {
    if (this.key) this.key.fill(0);
    this.key = null;
  }

  save(data) {
    if (!this.isUnlocked()) throw new Error('볼트가 잠겨 있습니다.');
    this._write(data);
  }

  /** 마스터 비밀번호 변경: 현재 비밀번호 검증 후 새 salt/key로 재암호화 */
  changePassword(currentPassword, newPassword, data) {
    if (!this.isUnlocked()) throw new Error('볼트가 잠겨 있습니다.');
    if (!newPassword || newPassword.length < 8) {
      throw new Error('새 마스터 비밀번호는 8자 이상이어야 합니다.');
    }
    const check = deriveKey(currentPassword, this.salt, this.kdf);
    if (!crypto.timingSafeEqual(check, this.key)) {
      throw new Error('현재 마스터 비밀번호가 올바르지 않습니다.');
    }
    this.salt = crypto.randomBytes(16);
    this.kdf = { ...KDF };
    this.key = deriveKey(newPassword, this.salt, this.kdf);
    this._write(data);
  }

  _write(data) {
    const { iv, tag, data: enc } = encrypt(this.key, data);
    const file = {
      version: FILE_VERSION,
      kdf: { name: this.kdf.name, salt: this.salt.toString('base64'), N: this.kdf.N, r: this.kdf.r, p: this.kdf.p },
      iv: iv.toString('base64'),
      tag: tag.toString('base64'),
      data: enc.toString('base64'),
    };
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    // 원자적 저장: 임시 파일에 쓴 뒤 교체
    const tmp = this.filePath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(file), 'utf8');
    fs.renameSync(tmp, this.filePath);
  }
}

module.exports = { Vault, emptyVault, deriveKey, encrypt, decrypt };

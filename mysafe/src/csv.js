'use strict';
// CSV 내보내기/가져오기 (RFC 4180 스타일, UTF-8 BOM 포함으로 엑셀 호환)

const HEADER = ['type', 'title', 'category', 'url', 'username', 'password', 'notes', 'fields'];

function escapeCell(v) {
  const s = v == null ? '' : String(v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function toCsv(records) {
  const lines = [HEADER.join(',')];
  for (const r of records) {
    const f = r.fields || {};
    const extra = {};
    for (const [k, v] of Object.entries(f)) {
      if (!['url', 'username', 'password'].includes(k)) extra[k] = v;
    }
    lines.push([
      r.type, r.title, r.category, f.url, f.username, f.password, r.notes,
      Object.keys(extra).length ? JSON.stringify(extra) : '',
    ].map(escapeCell).join(','));
  }
  return '\uFEFF' + lines.join('\r\n') + '\r\n';
}

function parseCsv(text) {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const rows = [];
  let row = [], cell = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else inQuotes = false;
      } else cell += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(cell); cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(x => x !== ''));
}

function fromCsv(text) {
  const rows = parseCsv(text);
  if (!rows.length) return [];
  const header = rows[0].map(h => h.trim().toLowerCase());
  const idx = name => header.indexOf(name);
  const out = [];
  for (const r of rows.slice(1)) {
    const get = name => (idx(name) >= 0 ? r[idx(name)] || '' : '');
    const fields = {};
    if (get('url')) fields.url = get('url');
    if (get('username')) fields.username = get('username');
    if (get('password')) fields.password = get('password');
    const extraRaw = get('fields');
    if (extraRaw) {
      try { Object.assign(fields, JSON.parse(extraRaw)); } catch (_) { /* 무시 */ }
    }
    out.push({
      type: get('type') || 'login',
      title: get('title') || get('name') || '(제목 없음)',
      category: get('category') || '',
      notes: get('notes') || '',
      fields,
    });
  }
  return out;
}

module.exports = { toCsv, fromCsv, parseCsv };

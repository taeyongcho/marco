'use strict';
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let last = null;
function licenseText(e) {
  return `MySafe 라이선스 (${e.typeLabel})\n\n사용자명: ${e.user}\n라이선스 키:\n${e.key}\n\n종류: ${e.typeLabel}\n만료일: ${e.expires || '없음 (기간 제한 없음)'}\n발급일: ${e.issuedAt.slice(0, 10)}\n발급: IT Brain Co., Ltd.\n\n등록 방법: MySafe 잠금 화면 → 「라이선스 등록」 → 사용자명과 키 입력`;
}
async function loadHistory() {
  const h = await window.gen.history();
  $('#hist').innerHTML = h.map(e => `<tr><td>${esc(e.issuedAt.slice(0, 10))}</td><td>${esc(e.user)}</td><td><span class="badge ${e.type === 1 ? 'trial' : ''}">${esc(e.typeLabel || (e.type === 1 ? '체험판' : '영구'))}</span></td><td>${esc(e.expires || '-')}</td><td>${esc(e.memo)}</td><td class="k">${esc(e.key)}</td></tr>`).join('')
    || '<tr><td colspan="6" class="muted">아직 발급한 라이선스가 없습니다.</td></tr>';
}
$('#f').addEventListener('submit', async ev => {
  ev.preventDefault();
  const kind = document.querySelector('input[name=kind]:checked').value;
  const r = await window.gen.generate($('#user').value, kind, $('#expires').value, $('#memo').value);
  const err = $('#err');
  if (!r.ok) { err.textContent = r.error; err.hidden = false; return; }
  err.hidden = true; last = r.data;
  $('#out').innerHTML = `<b>사용자명:</b> ${esc(last.user)}<br><b>종류:</b> <span class="badge ${last.type === 1 ? 'trial' : ''}">${esc(last.typeLabel)}</span><br><b>만료일:</b> ${esc(last.expires || '없음 (기간 제한 없음)')}<br><br>${esc(last.key)}`;
  $('#result').hidden = false;
  
/* 로그인 */
async function enter(isDefault) {
  $('#login').hidden = true; $('#wrap').hidden = false;
  $('#default-pw-warn').hidden = !isDefault;
  loadHistory(); setTimeout(() => $('#user').focus(), 30);
}
$('#login-form').addEventListener('submit', async ev => {
  ev.preventDefault();
  const r = await window.gen.unlock($('#login-pw').value);
  const err = $('#login-err');
  if (!r.ok) { err.textContent = r.error; err.hidden = false; $('#login-pw').value = ''; $('#login-pw').focus(); return; }
  err.hidden = true; $('#login-pw').value = '';
  enter(r.isDefault);
});
$('#btn-lock').addEventListener('click', async () => {
  await window.gen.lock();
  last = null; $('#result').hidden = true; $('#f').reset(); $('#hist').innerHTML = '';
  $('#wrap').hidden = true; $('#login').hidden = false; setTimeout(() => $('#login-pw').focus(), 30);
});
$('#btn-chpw').addEventListener('click', () => {
  ['#pw-cur', '#pw-new', '#pw-new2'].forEach(i => $(i).value = '');
  $('#pw-msg').hidden = true; $('#dlg-pw').showModal();
});
$('#pw-cancel').addEventListener('click', () => $('#dlg-pw').close());
$('#form-pw').addEventListener('submit', async ev => {
  ev.preventDefault();
  const msg = $('#pw-msg');
  if ($('#pw-new').value !== $('#pw-new2').value) { msg.textContent = '새 비밀번호 확인이 일치하지 않습니다.'; msg.hidden = false; return; }
  const r = await window.gen.changePassword($('#pw-cur').value, $('#pw-new').value);
  if (!r.ok) { msg.textContent = r.error; msg.hidden = false; return; }
  $('#dlg-pw').close(); $('#default-pw-warn').hidden = true;
  alert('비밀번호를 변경했습니다.');
});
});
$('#copy-key').addEventListener('click', () => last && window.gen.copy(last.key));
$('#copy-all').addEventListener('click', () => last && window.gen.copy(`사용자명: ${last.user}\n종류: ${last.typeLabel}\n라이선스 키: ${last.key}`));
$('#save').addEventListener('click', () => last && window.gen.saveText(`MySafe-License-${last.user}.txt`, licenseText(last)));
// 종류에 따라 만료일 입력칸 활성/비활성
document.querySelectorAll('input[name=kind]').forEach(r => r.addEventListener('change', () => {
  const trial = document.querySelector('input[name=kind]:checked').value === 'trial';
  $('#expires').disabled = !trial; if (!trial) $('#expires').value = '';
}));
$('#clear').addEventListener('click', async () => { if (confirm('발급 이력을 모두 삭제할까요?')) { await window.gen.clearHistory(); loadHistory(); } });

/* 로그인 */
async function enter(isDefault) {
  $('#login').hidden = true; $('#wrap').hidden = false;
  $('#default-pw-warn').hidden = !isDefault;
  loadHistory(); setTimeout(() => $('#user').focus(), 30);
}
$('#login-form').addEventListener('submit', async ev => {
  ev.preventDefault();
  const r = await window.gen.unlock($('#login-pw').value);
  const err = $('#login-err');
  if (!r.ok) { err.textContent = r.error; err.hidden = false; $('#login-pw').value = ''; $('#login-pw').focus(); return; }
  err.hidden = true; $('#login-pw').value = '';
  enter(r.isDefault);
});
$('#btn-lock').addEventListener('click', async () => {
  await window.gen.lock();
  last = null; $('#result').hidden = true; $('#f').reset(); $('#hist').innerHTML = '';
  $('#wrap').hidden = true; $('#login').hidden = false; setTimeout(() => $('#login-pw').focus(), 30);
});
$('#btn-chpw').addEventListener('click', () => {
  ['#pw-cur', '#pw-new', '#pw-new2'].forEach(i => $(i).value = '');
  $('#pw-msg').hidden = true; $('#dlg-pw').showModal();
});
$('#pw-cancel').addEventListener('click', () => $('#dlg-pw').close());
$('#form-pw').addEventListener('submit', async ev => {
  ev.preventDefault();
  const msg = $('#pw-msg');
  if ($('#pw-new').value !== $('#pw-new2').value) { msg.textContent = '새 비밀번호 확인이 일치하지 않습니다.'; msg.hidden = false; return; }
  const r = await window.gen.changePassword($('#pw-cur').value, $('#pw-new').value);
  if (!r.ok) { msg.textContent = r.error; msg.hidden = false; return; }
  $('#dlg-pw').close(); $('#default-pw-warn').hidden = true;
  alert('비밀번호를 변경했습니다.');
});

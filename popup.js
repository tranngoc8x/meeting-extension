import { WEEKDAYS, loadSchedule, saveSchedule } from './schedule.js';
import { DEFAULT_BACKEND_URL, api, backendStatusKey, getConnection, setBackendUrl } from './backend.js';

const $ = selector => document.querySelector(selector);
const local = chrome.storage.local;

// Backend /api/in-call results → label + tone.
const BOT_STATUS = {
  dispatched: ['Đã gửi bot vào phòng', 'ok'],
  queued: ['Bot đang bận, đã xếp hàng', 'warn'],
  already_dispatched: ['Phòng này đã có bot', 'ok'],
  duplicate: ['Phòng này đã có bot', 'ok'],
  failed: ['Gửi bot thất bại', 'danger'],
};

// --- Connection ---------------------------------------------------------------
async function renderConnection() {
  const { backendUrl, token, email } = await getConnection(local);
  const connected = Boolean(token);
  $('#backend-url').value = backendUrl;
  $('#conn-off').hidden = connected;
  $('#conn-on').hidden = !connected;
  $('#conn-email').textContent = email ?? '';
  $('#avatar').textContent = (email ?? '?').charAt(0).toUpperCase();
  $('#conn-badge').textContent = connected ? 'Đã kết nối' : 'Chưa kết nối';
  $('#conn-badge').classList.toggle('ok', connected);
  $('#conn-state').textContent = connected ? `Đã kết nối: ${email}` : 'Chưa kết nối backend';
  return connected;
}
$('#connect').addEventListener('click', async () => {
  $('#conn-error').textContent = '';
  $('#connect').disabled = true;
  try {
    await setBackendUrl(local, $('#backend-url').value || DEFAULT_BACKEND_URL);
    // The sign-in window steals focus and closes this popup; the service worker finishes the flow.
    const result = await chrome.runtime.sendMessage({ type: 'backend.connect' });
    if (!result?.ok) throw new Error(result?.error || 'Kết nối thất bại');
  } catch (error) {
    $('#conn-error').textContent = error.message;
  } finally {
    $('#connect').disabled = false;
  }
  if (await renderConnection()) await loadServerSchedule();
});
$('#disconnect').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'backend.disconnect' });
  await renderConnection();
});

// --- Active tab ----------------------------------------------------------------
function showTab(text, { live = false, room = '', bot = null } = {}) {
  $('#state').textContent = text;
  $('#state-dot').classList.toggle('live', live);
  $('#room').textContent = room;
  const [label, tone] = bot ? BOT_STATUS[bot] ?? [bot.replace(/^error: /, 'Lỗi: '), 'danger'] : [];
  $('#bot').hidden = !label;
  $('#bot').textContent = label ?? '';
  $('#bot').className = `pill ${tone ?? ''}`;
}
async function refresh() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!Number.isInteger(tab?.id)) throw new Error();
    const status = await chrome.tabs.sendMessage(tab.id, { type: 'meet.status' });
    if (!status?.detected) throw new Error();
    const saved = (await local.get(backendStatusKey(tab.id)))[backendStatusKey(tab.id)];
    showTab(status.inCall ? 'Đang trong cuộc họp' : 'Chưa vào cuộc họp', {
      live: status.inCall,
      room: status.meetingUrl?.replace('https://meet.google.com/', '') ?? '',
      bot: saved && saved.meetingUrl === status.meetingUrl ? saved.status : null,
    });
  } catch {
    // No content script answered: not a Meet tab, or a Meet tab opened before the extension loaded.
    showTab('Mở (hoặc tải lại) tab Google Meet để theo dõi');
  }
}
$('#refresh').addEventListener('click', refresh);
chrome.tabs.onActivated.addListener(refresh);

// --- Scan schedule -------------------------------------------------------------
const form = $('#schedule');
for (const [day, label] of WEEKDAYS) {
  $('#days').insertAdjacentHTML('beforeend',
    `<label class="day"><input type="checkbox" name="day" value="${day}" aria-label="${label}"><span>${label}</span></label>`);
}
function showSchedule({ start, end, days }) {
  form.start.value = start;
  form.end.value = end;
  for (const box of form.querySelectorAll('[name=day]')) box.checked = days.includes(Number(box.value));
}
function scheduleStatus(text, tone = '') {
  $('#schedule-status').textContent = text;
  $('#schedule-status').className = `muted small-text ${tone}`;
}
async function loadServerSchedule() {
  // When connected, the backend's copy is what the scanner actually uses.
  try { showSchedule((await api(local, 'GET', '/api/me')).schedule); }
  catch (error) { $('#conn-error').textContent = error.message; await renderConnection(); }
}
form.addEventListener('submit', async event => {
  event.preventDefault();
  try {
    const schedule = await saveSchedule(chrome.storage.sync, {
      start: form.start.value, end: form.end.value,
      days: [...form.querySelectorAll('[name=day]:checked')].map(box => Number(box.value))
    });
    const connected = Boolean((await getConnection(local)).token);
    if (connected) await api(local, 'PUT', '/api/settings', schedule);
    scheduleStatus(connected ? 'Đã lưu và đồng bộ' : 'Đã lưu trên máy', 'ok');
  } catch (error) {
    scheduleStatus(error.message, 'bad');
  }
});

{
  const now = new Date();
  const weekday = now.toLocaleDateString('vi-VN', { weekday: 'long' });
  const day = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}`;
  $('#today').textContent = `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)}, ${day}`;
}

(async () => {
  const connected = await renderConnection();
  showSchedule(await loadSchedule(chrome.storage.sync));
  if (connected) await loadServerSchedule();
  refresh();
})();

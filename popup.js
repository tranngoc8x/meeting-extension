import { WEEKDAYS, loadSchedule, saveSchedule } from './schedule.js';
import { DEFAULT_REMINDER_MINUTES, REMINDER_MINUTES_KEY, normalizeReminderMinutes } from './calendar-reminders.js';
import { api, backendStatusKey, getConnection, openDashboard } from './backend.js';
import { createRecordingStore } from './recording-store.js';
import { loadUploadMinutes, saveUploadMinutes } from './recording-upload-settings.js';
import { DEFAULT_LANGUAGE, getMessages, loadLanguage, saveLanguage } from './i18n.js';

const $ = selector => document.querySelector(selector);
const local = chrome.storage.local;
const recordingStore = createRecordingStore();
let expandedRecordingId = null;
let currentLang = DEFAULT_LANGUAGE;
let msg = getMessages(currentLang);

// Backend /integrations/in-call results → message key + tone.
const BOT_STATUS = {
  dispatched: ['botDispatched', 'ok'],
  queued: ['botQueued', 'warn'],
  already_dispatched: ['botAlready', 'ok'],
  duplicate: ['botAlready', 'ok'],
  failed: ['botFailed', 'danger'],
};

function renderToday() {
  const now = new Date();
  const weekday = now.toLocaleDateString(msg.locale, { weekday: 'long' });
  const day = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}`;
  $('#today').textContent = `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)}, ${day}`;
}

function applyTranslations(lang) {
  currentLang = lang;
  msg = getMessages(lang);
  document.documentElement.lang = lang;
  document.title = msg.docTitle;
  const langSelect = $('#lang-select');
  if (langSelect) {
    langSelect.value = lang;
    langSelect.setAttribute('aria-label', msg.langLabel);
  }
  const refreshBtn = $('#refresh');
  if (refreshBtn) {
    refreshBtn.title = msg.refreshTitle;
    refreshBtn.setAttribute('aria-label', msg.refreshTitle);
  }
  for (const el of document.querySelectorAll('[data-i18n]')) {
    const key = el.dataset.i18n;
    if (typeof msg[key] === 'string') el.textContent = msg[key];
  }
  for (const box of document.querySelectorAll('#days .day')) {
    const input = box.querySelector('input');
    const span = box.querySelector('span');
    const dayNum = Number(input?.value);
    const label = msg.weekdays[dayNum];
    if (label && input && span) {
      input.setAttribute('aria-label', label);
      span.textContent = label;
    }
  }
  for (const opt of document.querySelectorAll('#reminder-minutes option')) {
    const n = Number(opt.value);
    if (Number.isInteger(n)) opt.textContent = msg.reminderOption(n);
  }
  renderToday();
}

// --- Connection ---------------------------------------------------------------
async function renderConnection() {
  const { token, email } = await getConnection(local);
  const connected = Boolean(token);
  $('#conn-off').hidden = connected;
  $('#conn-on').hidden = !connected;
  $('#schedule-settings').hidden = !connected;
  $('#app-main').classList.toggle('signed-in', connected);
  $('#conn-email').textContent = email ?? '';
  $('#avatar').textContent = (email ?? '?').charAt(0).toUpperCase();
  $('#conn-badge').textContent = connected ? msg.connBadgeOn : msg.connBadgeOff;
  $('#conn-badge').classList.toggle('ok', connected);
  $('#conn-state').textContent = connected ? msg.connStateOn(email) : msg.connStateOff;
  return connected;
}
async function connectVia(button, via) {
  $('#conn-error').textContent = '';
  button.disabled = true;
  try {
    // The sign-in window steals focus and closes this popup; the service worker finishes the flow.
    const result = await chrome.runtime.sendMessage({ type: 'backend.connect', via });
    if (!result?.ok) throw new Error(result?.error || msg.connectFailed);
  } catch (error) {
    $('#conn-error').textContent = error.message;
  } finally {
    button.disabled = false;
  }
  if (await renderConnection()) await loadServerSchedule();
}
$('#connect').addEventListener('click', () => connectVia($('#connect'), 'google'));
$('#connect-dashboard').addEventListener('click', () => connectVia($('#connect-dashboard'), 'dashboard'));
$('#open-dashboard').addEventListener('click', async () => {
  $('#conn-error').textContent = '';
  try { await openDashboard(local, chrome.tabs); }
  catch (error) { $('#conn-error').textContent = error.message; await renderConnection(); }
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
  const entry = bot ? BOT_STATUS[bot] : null;
  const [label, tone] = entry
    ? [msg[entry[0]], entry[1]]
    : (bot ? [bot.replace(/^error: /, msg.errorPrefix), 'danger'] : []);
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
    showTab(status.inCall ? msg.inCall : msg.notInCall, {
      live: status.inCall,
      room: status.meetingUrl?.replace('https://meet.google.com/', '') ?? '',
      bot: saved && saved.meetingUrl === status.meetingUrl ? saved.status : null,
    });
  } catch {
    // No content script answered: not a Meet tab, or a Meet tab opened before the extension loaded.
    showTab(msg.openMeetHint);
  }
  await renderRecordings();
}

async function renderRecordings() {
  try {
    const records = await recordingStore.list();
    const preview = $('#recordings-preview');
    preview.replaceChildren();
    $('#recordings-empty').textContent = records.length ? '' : msg.recordingsEmpty;
    if (!records.some(record => record.id === expandedRecordingId)) expandedRecordingId = null;
    for (const record of records.slice(0, 6)) {
      const item = document.createElement('div');
      item.className = 'recording-preview-item';
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'recording-preview-row';
      row.setAttribute('aria-expanded', String(record.id === expandedRecordingId));
      const title = document.createElement('span');
      title.className = 'recording-preview-title';
      title.textContent = record.title || msg.untitledMeeting;
      const meta = document.createElement('span');
      meta.className = 'recording-preview-meta';
      meta.textContent = new Date(record.startedAt).toLocaleDateString(msg.locale);
      row.append(title, meta);
      row.addEventListener('click', () => {
        expandedRecordingId = expandedRecordingId === record.id ? null : record.id;
        renderRecordings();
      });
      item.append(row);
      if (record.id === expandedRecordingId) item.append(createRecordingDetails(record));
      preview.append(item);
    }
  } catch (error) {
    $('#recordings-empty').textContent = error.message;
  }
}

function formatRecordingDuration(record) {
  const seconds = Math.max(0, Math.floor((Date.parse(record.endedAt || new Date().toISOString()) - Date.parse(record.startedAt)) / 1000));
  return msg.formatDuration(Math.floor(seconds / 60), seconds % 60);
}

function formatRecordingSize(bytes) {
  return `${(Math.max(0, Number(bytes) || 0) / 1024 / 1024).toFixed(2)} MB`;
}

function fileName(record) {
  const title = (record.title || msg.untitledMeeting).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/g, '').slice(0, 120) || msg.untitledMeeting;
  return `${title} ${record.startedAt.replace(/[:.]/g, '-')}.webm`;
}

function recordingUploadLabel(record) {
  if (record.uploadState === 'queued') return msg.uploadQueued;
  if (record.uploadState === 'uploading') return msg.uploadUploading;
  if (record.uploadState === 'skipped-duration') return msg.uploadSkipped(record.uploadMinMinutes || 0);
  if (record.uploadState === 'error') return msg.uploadError(record.uploadError || msg.retryLater);
  return record.status === 'interrupted' ? msg.statusInterrupted : msg.statusSaved;
}

function createRecordingDetails(record) {
  const details = document.createElement('div');
  details.className = 'recording-preview-details';
  details.innerHTML = `
    <p><strong>${msg.detailTime}</strong> ${new Date(record.startedAt).toLocaleString(msg.locale)}</p>
    <p><strong>${msg.detailDuration}</strong> ${formatRecordingDuration(record)} · <strong>${msg.detailSize}</strong> ${formatRecordingSize(record.bytes)}</p>
    <p><strong>${msg.detailStatus}</strong> ${recordingUploadLabel(record)}</p>
  `;
  if (record.meetingUrl) {
    const room = document.createElement('p');
    room.textContent = record.meetingUrl;
    details.append(room);
  }
  const download = document.createElement('button');
  download.type = 'button';
  download.className = 'btn btn-save recording-preview-download';
  download.textContent = msg.downloadFile;
  download.disabled = record.status === 'recording' || !record.bytes;
  download.addEventListener('click', async event => {
    event.stopPropagation();
    download.disabled = true;
    try {
      const blob = await recordingStore.getBlob(record.id);
      if (!blob.size) throw new Error(msg.noAudioData);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName(record);
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (error) {
      const message = document.createElement('p');
      message.className = 'recording-preview-error';
      message.textContent = error.message;
      details.append(message);
    } finally {
      download.disabled = record.status === 'recording' || !record.bytes;
    }
  });
  details.append(download);
  return details;
}
$('#refresh').addEventListener('click', refresh);
$('#open-recordings').addEventListener('click', () => chrome.tabs.create({ url: chrome.runtime.getURL('recordings.html') }));
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
async function loadReminderMinutes() {
  const saved = (await chrome.storage.sync.get(REMINDER_MINUTES_KEY))[REMINDER_MINUTES_KEY];
  return normalizeReminderMinutes(saved ?? DEFAULT_REMINDER_MINUTES);
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
async function loadReminderStatus() {
  try {
    const status = await chrome.runtime.sendMessage({ type: 'calendar.reminders.status' });
    if (!status?.checkedAt) return;
    if (status.code === 'notifications_denied' || status.code === 'api_error' || status.code === 'not_connected') {
      scheduleStatus(status.message, 'bad');
    }
  } catch { /* service worker may not be ready yet */ }
}
form.addEventListener('submit', async event => {
  event.preventDefault();
  try {
    const schedule = await saveSchedule(chrome.storage.sync, {
      start: form.start.value, end: form.end.value,
      days: [...form.querySelectorAll('[name=day]:checked')].map(box => Number(box.value))
    });
    const reminderMinutes = normalizeReminderMinutes(form.reminderMinutes.value);
    await chrome.storage.sync.set({ [REMINDER_MINUTES_KEY]: reminderMinutes });
    const connected = Boolean((await getConnection(local)).token);
    if (connected) await saveUploadMinutes(chrome.storage.sync, form.recordingUploadMinutes.value);
    if (connected) await api(local, 'PUT', '/api/settings', schedule);
    if (connected) {
      const status = await chrome.runtime.sendMessage({ type: 'calendar.reminders.sync' });
      scheduleStatus(status?.message || (status?.notified ? msg.savedRemindersOn : msg.savedWaiting), status?.ok === false ? 'bad' : 'ok');
    } else scheduleStatus(msg.savedLocalOnly, 'ok');
  } catch (error) {
    scheduleStatus(error.message, 'bad');
  }
});

$('#lang-select')?.addEventListener('change', async event => {
  const lang = await saveLanguage(chrome.storage.sync, event.target.value);
  applyTranslations(lang);
  await renderConnection();
  await refresh();
});

chrome.storage?.onChanged?.addListener(async (changes, areaName) => {
  if (areaName !== 'sync' || !changes.uiLanguage) return;
  applyTranslations(changes.uiLanguage.newValue);
  await renderConnection();
  await refresh();
});

(async () => {
  applyTranslations(await loadLanguage(chrome.storage.sync));
  const connected = await renderConnection();
  showSchedule(await loadSchedule(chrome.storage.sync));
  form.reminderMinutes.value = String(await loadReminderMinutes());
  form.recordingUploadMinutes.value = String(await loadUploadMinutes(chrome.storage.sync));
  if (connected) await loadServerSchedule();
  if (connected) await loadReminderStatus();
  refresh();
})();

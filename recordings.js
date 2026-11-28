import { createRecordingStore } from './recording-store.js';
import { DEFAULT_LANGUAGE, LANGUAGE_KEY, getMessages, loadLanguage, normalizeLanguage, saveLanguage } from './i18n.js';

const store = createRecordingStore();
const $ = selector => document.querySelector(selector);
const PAGE_SIZE = 20;
const syncStorage = globalThis.chrome?.storage?.sync;
let records = [], currentPage = 1;
let msg = getMessages(DEFAULT_LANGUAGE);

function applyTranslations(lang) {
  msg = getMessages(lang);
  document.documentElement.lang = normalizeLanguage(lang);
  document.title = msg.recordingsDocTitle;
  const langSelect = $('#lang-select');
  if (langSelect) {
    langSelect.value = normalizeLanguage(lang);
    langSelect.setAttribute('aria-label', msg.langLabel);
  }
  for (const el of document.querySelectorAll('[data-i18n]')) {
    const key = el.dataset.i18n;
    if (typeof msg[key] === 'string') el.textContent = msg[key];
  }
  $('#recordings')?.setAttribute('aria-label', msg.recordingsListAria);
  $('#pagination')?.setAttribute('aria-label', msg.paginationAria);
}

function uploadStatus(record) {
  if (record.uploadState === 'queued') return msg.uploadQueued;
  if (record.uploadState === 'uploading') return msg.uploadUploading;
  if (record.uploadState === 'skipped-duration') return msg.uploadSkipped(record.uploadMinMinutes || 0);
  if (record.uploadState === 'error') return msg.uploadError(record.uploadError || msg.retryLater);
  if (record.status === 'recording') return msg.statusRecording;
  if (record.status === 'interrupted') return msg.statusInterrupted;
  return msg.statusSaved;
}
function element(tag, text, className) {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  return node;
}
function fileName(record) {
  const title = (record.title || msg.untitledMeeting).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/g, '').slice(0, 120) || msg.untitledMeeting;
  const time = record.startedAt.replace(/[:.]/g, '-');
  return `${title} ${time}.webm`;
}
async function download(record) {
  const blob = await store.getBlob(record.id);
  if (!blob.size) throw Error(msg.noAudioData);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName(record);
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
function run(button, operation) {
  button.disabled = true;
  $('#error').textContent = '';
  Promise.resolve().then(operation).catch(error => { $('#error').textContent = error.message; })
    .finally(() => { button.disabled = false; });
}
function renderPagination() {
  const pagination = $('#pagination');
  pagination.replaceChildren();
  const pageCount = Math.ceil(records.length / PAGE_SIZE);
  pagination.hidden = pageCount <= 1;
  if (pageCount <= 1) return;
  const previous = element('button', msg.prevPage);
  previous.type = 'button';
  previous.disabled = currentPage === 1;
  previous.addEventListener('click', () => { currentPage -= 1; renderPage(); });
  const status = element('span', msg.pageOf(currentPage, pageCount), 'pagination-status');
  const next = element('button', msg.nextPage);
  next.type = 'button';
  next.disabled = currentPage === pageCount;
  next.addEventListener('click', () => { currentPage += 1; renderPage(); });
  pagination.append(previous, status, next);
}
function renderPage() {
  $('#empty').textContent = records.length ? '' : msg.recordingsLibraryEmpty;
  $('#recordings').replaceChildren();
  const start = (currentPage - 1) * PAGE_SIZE;
  for (const record of records.slice(start, start + PAGE_SIZE)) {
    const card = document.createElement('article');
    card.append(element('h2', record.title || msg.untitledMeeting));
    const seconds = Math.max(0, Math.floor((Date.parse(record.endedAt || new Date().toISOString()) - Date.parse(record.startedAt)) / 1000));
    card.append(element('p', `${new Date(record.startedAt).toLocaleString(msg.locale)} · ${msg.formatDuration(Math.floor(seconds / 60), seconds % 60)} · ${(record.bytes / 1024 / 1024).toFixed(2)} MB`, 'meta'));
    card.append(element('p', record.meetingUrl || '', 'room'));
    card.append(element('span', uploadStatus(record), 'status'));
    if (record.status === 'interrupted') card.append(element('p', msg.interruptedWarning, 'warning'));
    const actions = element('div', '', 'actions');
    const downloadButton = element('button', msg.downloadShort, 'download');
    downloadButton.type = 'button';
    downloadButton.disabled = record.status === 'recording' || !record.bytes;
    downloadButton.addEventListener('click', () => run(downloadButton, () => download(record)));
    const removeButton = element('button', msg.deleteBtn);
    removeButton.type = 'button';
    removeButton.disabled = record.status === 'recording';
    removeButton.addEventListener('click', () => {
      if (confirm(msg.confirmDelete)) run(removeButton, async () => { await store.remove(record.id); await refresh(); });
    });
    actions.append(downloadButton, removeButton);
    card.append(actions);
    $('#recordings').append(card);
  }
  renderPagination();
}
async function refresh() {
  records = await store.list();
  currentPage = Math.min(currentPage, Math.max(1, Math.ceil(records.length / PAGE_SIZE)));
  renderPage();
}

$('#lang-select')?.addEventListener('change', async event => {
  const lang = syncStorage ? await saveLanguage(syncStorage, event.target.value) : normalizeLanguage(event.target.value);
  applyTranslations(lang);
  renderPage();
});

globalThis.chrome?.storage?.onChanged?.addListener((changes, areaName) => {
  if (areaName !== 'sync' || !changes[LANGUAGE_KEY]) return;
  applyTranslations(changes[LANGUAGE_KEY].newValue);
  renderPage();
});

$('#refresh').addEventListener('click', () => run($('#refresh'), refresh));
(async () => {
  applyTranslations(await loadLanguage(syncStorage));
  await refresh();
})().catch(error => { $('#error').textContent = error.message; $('#empty').textContent = ''; });

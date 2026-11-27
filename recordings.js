import { createRecordingStore } from './recording-store.js';
const store = createRecordingStore();
const $ = selector => document.querySelector(selector);
const PAGE_SIZE = 20;
let records = [], currentPage = 1;
const statuses = { recording: 'Đang ghi âm', 'pending-upload': 'Đã lưu trên máy', interrupted: 'Ghi âm bị gián đoạn' };
function element(tag, text, className) {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  return node;
}
function fileName(record) {
  const title = (record.title || 'Cuộc họp').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/g, '').slice(0, 120) || 'Cuộc họp';
  const time = record.startedAt.replace(/[:.]/g, '-');
  return `${title} ${time}.webm`;
}
async function download(record) {
  const blob = await store.getBlob(record.id);
  if (!blob.size) throw Error('Bản ghi chưa có dữ liệu âm thanh để tải về.');
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
  const previous = element('button', 'Trước');
  previous.type = 'button';
  previous.disabled = currentPage === 1;
  previous.addEventListener('click', () => { currentPage -= 1; renderPage(); });
  const status = element('span', `Trang ${currentPage} / ${pageCount}`, 'pagination-status');
  const next = element('button', 'Sau');
  next.type = 'button';
  next.disabled = currentPage === pageCount;
  next.addEventListener('click', () => { currentPage += 1; renderPage(); });
  pagination.append(previous, status, next);
}
function renderPage() {
  $('#empty').textContent = records.length ? '' : 'Chưa có bản ghi. Mở Google Meet và bấm icon July để bắt đầu.';
  $('#recordings').replaceChildren();
  const start = (currentPage - 1) * PAGE_SIZE;
  for (const record of records.slice(start, start + PAGE_SIZE)) {
    const card = document.createElement('article');
    card.append(element('h2', record.title || 'Cuộc họp'));
    const seconds = Math.max(0, Math.floor((Date.parse(record.endedAt || new Date().toISOString()) - Date.parse(record.startedAt)) / 1000));
    card.append(element('p', `${new Date(record.startedAt).toLocaleString('vi-VN')} · ${Math.floor(seconds / 60)} phút ${seconds % 60} giây · ${(record.bytes / 1024 / 1024).toFixed(2)} MB`, 'meta'));
    card.append(element('p', record.meetingUrl || '', 'room'));
    card.append(element('span', statuses[record.status] || 'Đã lưu trên máy', 'status'));
    if (record.status === 'interrupted') card.append(element('p', 'Phần cuối có thể chưa được lưu. File còn lại có thể chưa hoàn chỉnh; hãy tải về để kiểm tra.', 'warning'));
    const actions = element('div', '', 'actions');
    const downloadButton = element('button', 'Tải về', 'download');
    downloadButton.type = 'button';
    downloadButton.disabled = record.status === 'recording' || !record.bytes;
    downloadButton.addEventListener('click', () => run(downloadButton, () => download(record)));
    const removeButton = element('button', 'Xóa');
    removeButton.type = 'button';
    removeButton.disabled = record.status === 'recording';
    removeButton.addEventListener('click', () => {
      if (confirm('Xóa bản ghi này khỏi trình duyệt?')) run(removeButton, async () => { await store.remove(record.id); await refresh(); });
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
$('#refresh').addEventListener('click', () => run($('#refresh'), refresh));
refresh().catch(error => { $('#error').textContent = error.message; $('#empty').textContent = ''; });

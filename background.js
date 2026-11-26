import { recordTransition, tabKey } from './events.js';
import { DASHBOARD_AUTHORIZE_PATH, api, backendStatusKey, connect, disconnect, migrateLegacyBackend } from './backend.js';
import { loadSchedule } from './schedule.js';
import { createRecordingStore } from './recording-store.js';
import { createRecordingService, RECORDING_MESSAGES } from './recording-service.js';
import { createRecordingController } from './recording-controller.js';
// Serialize storage read/modify/write.
let queue = Promise.resolve();
function enqueue(operation) {
  const result = queue.then(operation);
  queue = result.catch(() => {});
  return result;
}
const ready = chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});
ready.catch(() => {});
// Updating from a localhost-default build: point the extension at the server.
chrome.runtime.onInstalled.addListener(() => { enqueue(() => migrateLegacyBackend(chrome.storage.local)).catch(() => {}); });
/** A new in-call transition: ask the backend for a bot. It deduplicates rooms that already have one. */
async function requestBot(tabId, event) {
  let status;
  try {
    status = (await api(chrome.storage.local, 'POST', '/integrations/v1/in-call', { meetingUrl: event.meetingUrl })).status;
  } catch (error) {
    status = `error: ${error.message}`;
  }
  await chrome.storage.local.set({ [backendStatusKey(tabId)]: { meetingUrl: event.meetingUrl, status, at: new Date().toISOString() } });
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  // Extension pages only (popup), never content scripts running on Meet.
  if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL(''))) return;
  if (message?.type === 'backend.connect') {
    connect(chrome.storage.local, chrome.identity, message.via === 'dashboard' ? DASHBOARD_AUTHORIZE_PATH : undefined)
      .then(async connection => {
        // Push the locally chosen scan schedule so the backend uses it from the first scan.
        await api(chrome.storage.local, 'PUT', '/api/settings', await loadSchedule(chrome.storage.sync)).catch(() => {});
        respond({ ok: true, email: connection.email });
      }, error => respond({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === 'backend.disconnect') {
    disconnect(chrome.storage.local).then(() => respond({ ok: true }), error => respond({ ok: false, error: error.message }));
    return true;
  }
});
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.type !== 'meet.transition') return;
  if (sender.id !== chrome.runtime.id || sender.frameId !== 0 || !Number.isInteger(sender.tab?.id)) {
    respond({ok:false, error:'Untrusted sender'});
    return;
  }
  enqueue(async () => {
    await ready;
    const url = new URL(sender.url);
    if (url.origin !== 'https://meet.google.com' || `${url.origin}${url.pathname.replace(/\/$/,'')}` !== message.event?.meetingUrl) throw Error('Room mismatch');
    return recordTransition(chrome.storage.local, sender.tab.id, message.event);
  }).then(event => {
    respond({ok:true,event});
    // Same requestId = a new transition, not a retry/reload of one already reported.
    if (event.inCall && event.requestId === message.event.requestId) requestBot(sender.tab.id, event).catch(() => {});
  }, () => respond({ok:false,error:'Local event could not be saved'}));
  return true;
});
const recordingStore = createRecordingStore();
const recordingController = createRecordingController(chrome, { interruptTab: tabId => recordingStore.interruptTab(tabId) });
const recordingMessage = createRecordingService({
  controller: recordingController,
  runtimeId: chrome.runtime.id,
  getURL: path => chrome.runtime.getURL(path),
  openLibrary: () => chrome.tabs.create({ url: chrome.runtime.getURL('recordings.html') }),
  openSettings: () => chrome.runtime.openOptionsPage(),
});
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (!RECORDING_MESSAGES.has(message?.type)) return;
  // Do not queue state/stop behind a media startup waiting for user permission.
  recordingMessage(message, sender).then(respond, error => respond({ ok: false, error: error.message, ...(error.needsMicrophone ? { needsMicrophone: true } : {}) }));
  return true;
});
chrome.tabs.onRemoved.addListener(tabId => {
  enqueue(async () => {
    await chrome.storage.local.remove([tabKey(tabId), backendStatusKey(tabId)]);
    await recordingController.tabClosed(tabId);
  }).catch(() => {});
});
// Offscreen owns the media; explicitly stop when its Meet document goes away.
chrome.tabs.onUpdated?.addListener((tabId, change) => {
  if (change.status === 'loading') recordingController.tabNavigated(tabId).catch(() => {});
});
// The toolbar action itself grants tab access and starts recording; no popup or
// second Record click sits between invocation and capture.
chrome.action?.onClicked.addListener(async tab => {
  const isMeet = /^https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}(?:[/?#]|$)/.test(tab.url || '');
  if (!isMeet) { await chrome.runtime.openOptionsPage(); return; }
  try {
    const status = await recordingController.status(tab.id);
    if (status.active) await recordingController.stop(tab.id);
    else await recordingController.start(tab);
  } catch (error) {
    const status = await recordingController.status(tab.id).catch(() => null);
    // Preserve the Stop control when capture may still be active.
    if (status && !status.active) chrome.tabs.sendMessage(tab.id, {
      type: 'recording.state', ...status, state: { status: 'error', error: error.message },
    }).catch(() => {});
  }
});
chrome.commands?.onCommand.addListener((command, tab) => {
  if (command !== 'record-meeting') return;
  (async () => {
    const status = await recordingController.status();
    if (status.active) await recordingController.stop();
    else await recordingController.start(tab);
  })().catch(() => {}); // controller publishes actionable errors to the Meet card.
});
// Tab IDs are not durable across browser sessions. Reload within a session keeps ID.
chrome.runtime.onStartup.addListener(() => {
  enqueue(async () => {
    const data = await chrome.storage.local.get(null);
    await chrome.storage.local.remove(Object.keys(data).filter(k => k.startsWith('meet-detection:') || k.startsWith('meet-backend:')));
    if (!(await recordingController.status()).active) await recordingStore.recover();
  }).catch(() => {});
});

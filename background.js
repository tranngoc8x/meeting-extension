import { recordTransition, tabKey } from './events.js';
import { DASHBOARD_AUTHORIZE_PATH, api, backendStatusKey, connect, disconnect } from './backend.js';
import { loadSchedule } from './schedule.js';
// Serialize storage read/modify/write.
let queue = Promise.resolve();
function enqueue(operation) {
  const result = queue.then(operation);
  queue = result.catch(() => {});
  return result;
}
const ready = chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});
ready.catch(() => {});
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
chrome.tabs.onRemoved.addListener(tabId => { enqueue(() => chrome.storage.local.remove([tabKey(tabId), backendStatusKey(tabId)])).catch(() => {}); });
// Tab IDs are not durable across browser sessions. Reload within a session keeps ID.
chrome.runtime.onStartup.addListener(() => {
  enqueue(async () => {
    const data = await chrome.storage.local.get(null);
    await chrome.storage.local.remove(Object.keys(data).filter(k => k.startsWith('meet-detection:') || k.startsWith('meet-backend:')));
  }).catch(() => {});
});

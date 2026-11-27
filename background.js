import { recordTransition, tabKey } from './events.js';
import { DASHBOARD_AUTHORIZE_PATH, api, backendStatusKey, connect, disconnect, getConnection, migrateLegacyBackend } from './backend.js';
import { REMINDER_ALARM, REMINDER_STATUS_KEY, clearCalendarReminders, syncCalendarReminders } from './calendar-reminders.js';
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

function scheduleCalendarReminders() {
  chrome.alarms?.create?.(REMINDER_ALARM, { delayInMinutes: 1, periodInMinutes: 1 });
}
scheduleCalendarReminders();

export async function pollCalendarReminders() {
  const notifications = chrome.notifications;
  const saveStatus = status => chrome.storage.local.set({ [REMINDER_STATUS_KEY]: { ...status, checkedAt: new Date().toISOString() } }).catch(() => {});
  if (!notifications?.create) { await saveStatus({ ok: false, code: 'notifications_unavailable', message: 'Chrome không hỗ trợ thông báo.' }); return; }
  let permission = null;
  try { permission = await notifications.getPermissionLevel?.(); } catch { /* best effort */ }
  if (permission === 'denied') { await saveStatus({ ok: false, code: 'notifications_denied', message: 'Thông báo của Chrome đang bị chặn cho July.' }); return; }
  const { token } = await getConnection(chrome.storage.local);
  if (!token) { await saveStatus({ ok: false, code: 'not_connected', message: 'Chưa đăng nhập July.' }); return; }
  const reminderMinutes = (await chrome.storage.sync.get('calendarReminderMinutes')).calendarReminderMinutes;
  let result;
  try {
    result = await syncCalendarReminders({
      storage: chrome.storage.local,
      reminderMinutes,
      apiFn: () => api(chrome.storage.local, 'GET', '/api/meetings'),
      notifications: {
        create: async (id, options) => {
          if (options.data?.meetUrl) {
            await chrome.storage.local.set({ [`calendar-notification-url:${id}`]: options.data.meetUrl });
          }
          return notifications.create(id, options);
        },
      },
    });
  } catch (error) {
    await saveStatus({ ok: false, code: 'notification_error', message: error.message || 'Không tạo được thông báo Chrome.' });
    return;
  }
  await saveStatus(result.error
    ? { ok: false, code: 'api_error', message: result.error.message || 'Không lấy được lịch họp.' }
    : { ok: true, code: result.notified ? 'notified' : 'no_due_meeting', notified: result.notified });
  if (result.error && !(await getConnection(chrome.storage.local)).token) {
    await clearCalendarReminders(chrome.storage.local, chrome.alarms);
  }
}

async function handleReminderMessage(message, respond) {
  if (message?.type === 'calendar.reminders.sync') {
    await pollCalendarReminders();
    respond({ ok: true, ...(await chrome.storage.local.get(REMINDER_STATUS_KEY))[REMINDER_STATUS_KEY] });
    return true;
  }
  if (message?.type === 'calendar.reminders.status') {
    respond({ ok: true, ...(await chrome.storage.local.get(REMINDER_STATUS_KEY))[REMINDER_STATUS_KEY] });
    return true;
  }
  return false;
}

let reminderPollQueue = Promise.resolve();
function queueCalendarReminderPoll() {
  reminderPollQueue = reminderPollQueue.then(() => pollCalendarReminders()).catch(() => {});
  return reminderPollQueue;
}

chrome.alarms?.onAlarm?.addListener(alarm => {
  if (alarm?.name === REMINDER_ALARM) queueCalendarReminderPoll();
});
chrome.notifications?.onClicked?.addListener(notificationId => {
  (async () => {
    const key = `calendar-notification-url:${notificationId}`;
    const saved = (await chrome.storage.local.get(key))[key];
    if (saved) await chrome.tabs.create({ url: saved });
    await chrome.storage.local.remove(key);
  })().catch(() => {});
});
// Updating from a localhost-default build: point the extension at the server.
chrome.runtime.onInstalled.addListener(() => {
  enqueue(() => migrateLegacyBackend(chrome.storage.local)).catch(() => {});
  scheduleCalendarReminders();
});
/*
 * Bot dispatch is intentionally paused while recording is handled locally by
 * the extension. Keep this implementation here for a later portal/bot phase.
 */
/*
async function requestBot(tabId, event) {
  let status;
  try {
    status = (await api(chrome.storage.local, 'POST', '/integrations/v1/in-call', { meetingUrl: event.meetingUrl })).status;
  } catch (error) {
    status = `error: ${error.message}`;
  }
  await chrome.storage.local.set({ [backendStatusKey(tabId)]: { meetingUrl: event.meetingUrl, status, at: new Date().toISOString() } });
}
*/
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.type === 'calendar.reminders.sync' || message?.type === 'calendar.reminders.status') {
    if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL(''))) { respond({ ok: false, error: 'Untrusted sender' }); return; }
    handleReminderMessage(message, respond).catch(error => respond({ ok: false, error: error.message }));
    return true;
  }
  // Extension pages only (popup), never content scripts running on Meet.
  if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL(''))) return;
  if (message?.type === 'backend.connect') {
    connect(chrome.storage.local, chrome.identity, message.via === 'dashboard' ? DASHBOARD_AUTHORIZE_PATH : undefined)
      .then(async connection => {
        // Push the locally chosen scan schedule so the backend uses it from the first scan.
        await api(chrome.storage.local, 'PUT', '/api/settings', await loadSchedule(chrome.storage.sync)).catch(() => {});
        scheduleCalendarReminders();
        respond({ ok: true, email: connection.email });
      }, error => respond({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === 'backend.disconnect') {
    disconnect(chrome.storage.local).then(async () => {
      await clearCalendarReminders(chrome.storage.local, chrome.alarms);
      respond({ ok: true });
    }, error => respond({ ok: false, error: error.message }));
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
    // Bot dispatch is paused for the local-recording phase.
    // if (event.inCall && event.requestId === message.event.requestId) requestBot(sender.tab.id, event).catch(() => {});
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
function updateRecordingIndicator(result = {}) {
  const status = result.state?.status || (result.active ? 'recording' : 'idle');
  const indicator = status === 'recording' ? { text: '●', color: '#d93025', title: 'July · Đang ghi âm' }
    : ['starting', 'waiting-microphone', 'saving'].includes(status) ? { text: '…', color: '#f9ab00', title: 'July · Đang xử lý ghi âm' }
      : status === 'error' ? { text: '!', color: '#c5221f', title: 'July · Ghi âm gặp lỗi' }
        : { text: '', color: '#5f6368', title: 'July · Sẵn sàng ghi âm' };
  (async () => {
    try {
      await chrome.action.setBadgeText?.({ text: indicator.text });
      await chrome.action.setBadgeBackgroundColor?.({ color: indicator.color });
      await chrome.action.setTitle?.({ title: indicator.title });
    } catch { /* indicator is best-effort on older/test Chrome surfaces */ }
  })();
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (!RECORDING_MESSAGES.has(message?.type)) return;
  // Do not queue state/stop behind a media startup waiting for user permission.
  recordingMessage(message, sender).then(result => {
    updateRecordingIndicator(message.type === 'recording.state' ? { ...result, state: message.state, active: message.active } : result);
    respond(result);
  }, error => {
    updateRecordingIndicator({ state: { status: 'error' } });
    respond({ ok: false, error: error.message, ...(error.needsMicrophone ? { needsMicrophone: true } : {}), ...(error.needsInvocation ? { needsInvocation: true } : {}) });
  });
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
function toggleRecording(tab) {
  return (async () => {
    const status = await recordingController.status();
    const result = status.active || status.state.status === 'waiting-microphone'
      ? await recordingController.stop()
      : await recordingController.start(tab);
    updateRecordingIndicator(result);
    return result;
  })().catch(() => { updateRecordingIndicator({ state: { status: 'error' } }); }); // controller publishes actionable errors to the Meet card.
}
chrome.action.onClicked.addListener(toggleRecording);
chrome.commands?.onCommand.addListener((command, tab) => {
  if (command === 'record-meeting') return toggleRecording(tab);
});
// Tab IDs are not durable across browser sessions. Reload within a session keeps ID.
chrome.runtime.onStartup.addListener(() => {
  scheduleCalendarReminders();
  enqueue(async () => {
    const data = await chrome.storage.local.get(null);
    await chrome.storage.local.remove(Object.keys(data).filter(k => k.startsWith('meet-detection:') || k.startsWith('meet-backend:')));
    if (!(await recordingController.status()).active) await recordingStore.recover();
  }).catch(() => {});
});

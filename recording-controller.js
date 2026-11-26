const KEY = 'recording-controller';
const ROOM = /^https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}$/;
const BUSY = new Set(['starting', 'recording', 'saving']);
const STATUSES = new Set(['idle', ...BUSY, 'saved', 'error']);
const empty = () => ({ state: { status: 'idle' }, active: false, tabId: null, meetingUrl: null, captureId: null });

export function createRecordingController(chrome, { interruptTab = async () => {} } = {}) {
  let current = empty(), loaded, queue = Promise.resolve(), publishing = Promise.resolve(), pendingStart = null;
  const offscreenUrl = chrome.runtime.getURL('offscreen.html');
  function enqueue(operation) {
    const result = queue.then(operation);
    queue = result.catch(() => {});
    return result;
  }
  async function load() {
    loaded ??= (async () => {
      const stored = await chrome.storage.session?.get(KEY);
      if (stored?.[KEY]?.state && STATUSES.has(stored[KEY].state.status)) current = stored[KEY];
    })();
    await loaded;
  }
  async function shortcut() {
    return (await chrome.commands?.getAll?.())?.find(command => command.name === 'record-meeting')?.shortcut || '';
  }
  async function view(tabId) {
    if (Number.isInteger(tabId) && current.tabId !== tabId) {
      return { ok: true, ...empty(), busyElsewhere: Boolean(current.active), shortcut: await shortcut() };
    }
    return { ok: true, ...current, shortcut: await shortcut() };
  }
  async function publish(snapshot) {
    current = {
      state: snapshot.state, active: snapshot.active ?? BUSY.has(snapshot.state.status),
      tabId: snapshot.tabId ?? null, meetingUrl: snapshot.meetingUrl ?? null, captureId: snapshot.captureId ?? null,
    };
    const saved = current;
    publishing = publishing.catch(() => {}).then(async () => {
      await chrome.storage.session?.set({ [KEY]: saved });
      if (Number.isInteger(saved.tabId)) {
        await chrome.tabs.sendMessage(saved.tabId, { type: 'recording.state', ...saved, shortcut: await shortcut() }).catch(() => {});
      }
    });
    await publishing;
  }
  async function exists() {
    return (await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [offscreenUrl] })).length > 0;
  }
  async function request(type, data = {}) {
    const result = await chrome.runtime.sendMessage({ target: 'offscreen', type: `recording.offscreen.${type}`, ...data });
    if (!result?.ok) throw Object.assign(new Error(result?.error || 'Không liên lạc được bộ ghi âm.'), { needsMicrophone: Boolean(result?.needsMicrophone) });
    return result;
  }
  async function sync() {
    await load();
    if (await exists()) {
      const remote = await request('status');
      if (remote?.state && STATUSES.has(remote.state.status)
          && (remote.captureId || remote.active || current.state.status === 'idle')) await publish(remote);
    } else if (current.active) {
      const tabId = current.tabId;
      await publish({ ...current, active: false, state: { status: 'error', error: 'Bộ ghi âm đã bị gián đoạn. Kiểm tra bản ghi trên máy.' } });
      if (Number.isInteger(tabId)) await interruptTab(tabId);
    }
  }
  async function openMicrophone() {
    await chrome.tabs.create({ url: chrome.runtime.getURL('microphone.html') });
  }
  async function start(tab) {
    return enqueue(async () => {
      await sync();
      const target = tab ? (await chrome.tabs.get?.(tab.id) || tab) : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
      let meetingUrl;
      try { const url = new URL(target?.url); meetingUrl = `${url.origin}${url.pathname.replace(/\/$/, '')}`; } catch { /* validated below */ }
      if (!Number.isInteger(target?.id) || !ROOM.test(meetingUrl)) throw Error('Mở tab Google Meet để ghi âm.');
      if (current.active) {
        if (current.tabId === target.id) return view();
        throw Error('Một tab Meet khác đang ghi âm. Hãy dừng bản ghi đó trước.');
      }
      const meeting = await chrome.tabs.sendMessage(target.id, { type: 'meet.status' });
      if (!meeting?.inCall || meeting.meetingUrl !== meetingUrl) throw Error('Tham gia cuộc họp trước khi bắt đầu ghi âm.');
      const attempt = { tabId: target.id, meetingUrl, captureId: crypto.randomUUID(), canceled: false, dispatched: false };
      pendingStart = attempt;
      try {
        await publish({ ...attempt, active: true, state: { status: 'starting' } });
        if (!await exists()) await chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: ['USER_MEDIA'], justification: 'Record Meet tab audio and microphone without screen sharing.' });
        const permission = await request('permissions');
        if (attempt.canceled) {
          await publish({ ...attempt, active: false, state: { status: 'idle' } });
          return view();
        }
        if (permission.microphone !== 'granted') {
          await openMicrophone();
          throw Object.assign(Error('Cho phép micro trên trang July, rồi quay lại Meet và bấm ghi âm.'), { needsMicrophone: true });
        }
        const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: target.id });
        if (attempt.canceled) {
          await publish({ ...attempt, active: false, state: { status: 'idle' } });
          return view();
        }
        attempt.dispatched = true;
        const result = await request('start', { metadata: {
          streamId, tabId: target.id, documentId: null, meetingUrl,
          title: String(meeting.title || target.title || meetingUrl.split('/').at(-1)).trim().slice(0, 200),
          captureId: attempt.captureId,
        } });
        await publish(result);
        return view();
      } catch (error) {
        await publish({ ...attempt, active: false, state: { status: 'error', error: error.message, ...(error.needsMicrophone ? { needsMicrophone: true } : {}) } });
        throw error;
      } finally { if (pendingStart === attempt) pendingStart = null; }
    });
  }
  async function stopFailure(error) {
    // Losing either status or stop responses does not prove media stopped.
    let stopped = false;
    try { await chrome.offscreen.closeDocument(); stopped = true; } catch { /* retain active until reconciled */ }
    if (stopped && Number.isInteger(current.tabId)) await interruptTab(current.tabId);
    await publish({ ...current, active: !stopped, state: { status: 'error', error: error.message } });
    throw error;
  }
  async function stop(tabId) {
    // Startup can be waiting on media. Cancellation must not sit behind its queue.
    await load();
    if (pendingStart && (!Number.isInteger(tabId) || pendingStart.tabId === tabId)) {
      pendingStart.canceled = true;
      if (pendingStart.dispatched) {
        try { await publish(await request('stop')); }
        catch (error) { return stopFailure(error); }
      }
      return view(tabId);
    }
    return enqueue(async () => {
      // A content sender may never close another tab's media owner, even if
      // communication with the owner has failed.
      if (Number.isInteger(tabId) && current.tabId !== tabId) return view(tabId);
      try {
        await sync();
        if (Number.isInteger(tabId) && current.tabId !== tabId) return view(tabId);
        if (current.active) await publish(await request('stop'));
      } catch (error) { return stopFailure(error); }
      return view(tabId);
    });
  }
  async function onState(message, sender) {
    if (sender.id !== chrome.runtime.id || sender.url !== offscreenUrl || sender.tab) throw Error('Untrusted recording state');
    if (!message?.state || !STATUSES.has(message.state.status)) throw Error('Invalid recording state');
    await load();
    if (current.captureId && current.captureId !== message.captureId) return { ok: true, ignored: true };
    await publish(message);
    return { ok: true };
  }
  const status = async tabId => {
    await load();
    // Startup can wait for device permission. Reopened UI must still expose
    // its provisional state and cancellation control during that wait.
    if (pendingStart) return view(tabId);
    return enqueue(async () => { await sync(); return view(tabId); });
  };
  const ended = async tabId => {
    try { await stop(tabId); }
    catch { /* stop already saved the visible failure; preserve acknowledged chunks */ }
    await interruptTab(tabId);
  };
  return { start, stop, status, onState, tabClosed: ended, tabNavigated: ended, openMicrophone };
}

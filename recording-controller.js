const KEY = 'recording-controller';
const MICROPHONE_PENDING = 'recording-microphone-pending';
const MICROPHONE_READY = 'recording-microphone-ready';
const ROOM = /^https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}$/;
const BUSY = new Set(['starting', 'recording', 'saving']);
const STATUSES = new Set(['idle', ...BUSY, 'waiting-microphone', 'saved', 'error']);
const empty = () => ({ state: { status: 'idle' }, active: false, tabId: null, meetingUrl: null, captureId: null });
function canonicalRoom(value) {
  try {
    const url = new URL(value), room = `${url.origin}${url.pathname.replace(/\/$/, '')}`;
    return ROOM.test(room) ? room : null;
  } catch { return null; }
}
function invocationRequired() {
  return Object.assign(Error('Bấm icon July để ghi âm lần đầu trên tab này. Sau đó có thể ghi/dừng ngay tại card.'), { needsInvocation: true });
}

export function createRecordingController(chrome, { interruptTab = async () => {} } = {}) {
  let current = empty(), loaded, queue = Promise.resolve(), publishing = Promise.resolve(), pendingStart = null, pendingMicrophone = null, microphoneRegistration = null;
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
      const pending = await chrome.storage.session?.get(MICROPHONE_PENDING);
      pendingMicrophone = pending?.[MICROPHONE_PENDING] || null;
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
      if (remote?.state && STATUSES.has(remote.state.status) && (!pendingMicrophone || remote.active)
          && (remote.captureId || remote.active || current.state.status === 'idle')) await publish(remote);
    } else if (current.active) {
      const tabId = current.tabId;
      await publish({ ...current, active: false, state: { status: 'error', error: 'Bộ ghi âm đã bị gián đoạn. Kiểm tra bản ghi trên máy.' } });
      if (Number.isInteger(tabId)) await interruptTab(tabId);
    }
  }
  async function saveMicrophonePending(value) {
    pendingMicrophone = value;
    await chrome.storage.session?.set({ [MICROPHONE_PENDING]: value });
  }
  async function cancelMicrophone() {
    const waiting = pendingMicrophone;
    await saveMicrophonePending(null);
    if (waiting && current.state.status === 'waiting-microphone') {
      await publish({ ...current, active: false, state: { status: 'idle' } });
    }
  }
  function openMicrophone(target = null) {
    if (microphoneRegistration) return microphoneRegistration;
    const registering = (async () => {
      await load();
      const existing = pendingMicrophone;
      if (existing && existing.tabId === (target?.tabId ?? null) && existing.meetingUrl === (target?.meetingUrl ?? null)) {
        try {
          const helper = await chrome.tabs.get(existing.helperTabId);
          if (target?.canceled || pendingMicrophone !== existing) return false;
          const windowId = helper.windowId ?? existing.helperWindowId;
          if (Number.isInteger(windowId)) await chrome.windows.update(windowId, { focused: true });
          await chrome.tabs.update(existing.helperTabId, { active: true });
          return !target?.canceled && pendingMicrophone === existing;
        } catch {
          if (pendingMicrophone !== existing) return false;
          await saveMicrophonePending(null);
        }
      }
      if (target?.canceled) return false;
      const window = await chrome.windows.create({ url: chrome.runtime.getURL('microphone.html'), type: 'popup', width: 460, height: 420, focused: true });
      const helper = window.tabs?.[0];
      if (!Number.isInteger(helper?.id)) throw Error('Không mở được trang cấp quyền micro.');
      if (!target?.canceled) {
        await saveMicrophonePending({
          tabId: target?.tabId ?? null, meetingUrl: target?.meetingUrl ?? null, documentId: target?.documentId ?? null,
          helperTabId: helper.id, helperWindowId: window.id,
        });
      }
      if (target?.canceled) {
        await saveMicrophonePending(null);
        await chrome.tabs.remove?.(helper.id).catch(() => {});
        return false;
      }
      return true;
    })();
    const registered = registering.finally(() => { if (microphoneRegistration === registered) microphoneRegistration = null; });
    microphoneRegistration = registered;
    return registered;
  }
  async function waitForMicrophone(attempt) {
    const registered = await openMicrophone(attempt);
    if (!registered || attempt.canceled) {
      await cancelMicrophone();
      await publish({ ...attempt, active: false, state: { status: 'idle' } });
      return view();
    }
    await publish({ ...attempt, active: false, state: { status: 'waiting-microphone', needsMicrophone: true } });
    return view();
  }
  async function contentMeeting(target, expectedRoom, documentId) {
    if (!target?.url) throw invocationRequired();
    if (canonicalRoom(target.url) !== expectedRoom) throw Error('Trang Meet đã đổi phòng. Hãy bắt đầu lại trong cuộc họp hiện tại.');
    let meeting;
    try { meeting = await chrome.tabs.sendMessage(target.id, { type: 'meet.status' }, { documentId }); }
    catch { throw Error('Trang Meet đã thay đổi. Hãy bắt đầu lại trong cuộc họp hiện tại.'); }
    if (!meeting?.inCall || meeting.meetingUrl !== expectedRoom) throw Error('Tham gia đúng cuộc họp trước khi bắt đầu ghi âm.');
    return meeting;
  }
  async function start(tab, { microphoneAuthorized = false, permissionHandoff = false, microphoneRequest = null, expectedRoom = null, documentId = null, contentInvocation = false } = {}) {
    const handoffCanceled = () => microphoneRequest && pendingMicrophone !== microphoneRequest;
    return enqueue(async () => {
      await sync();
      if (handoffCanceled()) throw Error('Microphone permission request was canceled');
      const target = tab ? (await chrome.tabs.get?.(tab.id) || tab) : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
      if (contentInvocation && !target?.url) throw invocationRequired();
      let meetingUrl;
      try { const url = new URL(target?.url); meetingUrl = `${url.origin}${url.pathname.replace(/\/$/, '')}`; } catch { /* validated below */ }
      if (!Number.isInteger(target?.id) || !ROOM.test(meetingUrl)) throw Error('Mở tab Google Meet để ghi âm.');
      if (expectedRoom && meetingUrl !== expectedRoom) throw Error('Trang Meet đã đổi phòng. Hãy bắt đầu lại trong cuộc họp hiện tại.');
      let meeting = contentInvocation ? await contentMeeting(target, expectedRoom, documentId) : null;
      if (current.active) {
        if (current.tabId === target.id) return view();
        throw Error('Một tab Meet khác đang ghi âm. Hãy dừng bản ghi đó trước.');
      }
      meeting ||= await chrome.tabs.sendMessage(target.id, { type: 'meet.status' });
      if (!meeting?.inCall || meeting.meetingUrl !== meetingUrl) throw Error('Tham gia cuộc họp trước khi bắt đầu ghi âm.');
      if (handoffCanceled()) throw Error('Microphone permission request was canceled');
      const attempt = { tabId: target.id, meetingUrl, documentId, captureId: crypto.randomUUID(), canceled: false, dispatched: false, microphoneRequest };
      if (microphoneRequest) microphoneRequest.resumingCaptureId = attempt.captureId;
      pendingStart = attempt;
      try {
        if (microphoneRequest) {
          // Persist the handoff identity before media starts so a replacement
          // worker can still cancel it if the helper disappears mid-acquisition.
          await chrome.storage.session?.set({ [MICROPHONE_PENDING]: microphoneRequest });
          if (attempt.canceled || handoffCanceled()) {
            await cancelMicrophone();
            await publish({ ...attempt, active: false, state: { status: 'idle' } });
            return view();
          }
        }
        await publish({ ...attempt, active: true, state: { status: 'starting' } });
        if (!await exists()) await chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: ['USER_MEDIA'], justification: 'Record Meet tab audio and microphone without screen sharing.' });
        const savedPermission = await chrome.storage.local?.get(MICROPHONE_READY);
        const knownMicrophone = microphoneAuthorized || savedPermission?.[MICROPHONE_READY] === true;
        const permission = knownMicrophone ? null : await request('permissions');
        if (attempt.canceled || handoffCanceled()) {
          await publish({ ...attempt, active: false, state: { status: 'idle' } });
          return view();
        }
        if (!knownMicrophone && permission.microphone !== 'granted') return await waitForMicrophone(attempt);
        if (contentInvocation) await contentMeeting(await chrome.tabs.get(target.id), expectedRoom, documentId);
        if (attempt.canceled || handoffCanceled()) {
          await publish({ ...attempt, active: false, state: { status: 'idle' } });
          return view();
        }
        let streamId;
        try { streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: target.id }); }
        catch (error) {
          if (/Extension has not been invoked|activeTab/i.test(error.message || '')) throw invocationRequired();
          throw error;
        }
        if (contentInvocation) await contentMeeting(await chrome.tabs.get(target.id), expectedRoom, documentId);
        if (attempt.canceled || handoffCanceled()) {
          await publish({ ...attempt, active: false, state: { status: 'idle' } });
          return view();
        }
        attempt.dispatched = true;
        const result = await request('start', { metadata: {
          streamId, tabId: target.id, documentId, meetingUrl,
          title: String(meeting.title || target.title || meetingUrl.split('/').at(-1)).trim().slice(0, 200),
          captureId: attempt.captureId,
          ...(knownMicrophone ? { microphoneAuthorized: true } : {}),
        } });
        if (attempt.canceled || handoffCanceled()) {
          try { await publish(await request('stop')); }
          catch (error) { return stopFailure(error); }
          return view();
        }
        await publish(result);
        if (result.state?.needsMicrophone) {
          await chrome.storage.local?.set({ [MICROPHONE_READY]: false });
          if (!permissionHandoff) return await waitForMicrophone(attempt);
        } else if (result.state?.status === 'recording') {
          await chrome.storage.local?.set({ [MICROPHONE_READY]: true });
        }
        return view();
      } catch (error) {
        await publish({ ...attempt, active: false, state: { status: 'error', error: error.message, ...(error.needsMicrophone ? { needsMicrophone: true } : {}), ...(error.needsInvocation ? { needsInvocation: true } : {}) } });
        throw error;
      } finally { if (pendingStart === attempt) pendingStart = null; }
    });
  }
  function startFromContent(tab, senderUrl, documentId) {
    const expectedRoom = canonicalRoom(senderUrl);
    if (!Number.isInteger(tab?.id) || tab.id < 0 || !expectedRoom || typeof documentId !== 'string' || !documentId) throw Error('Untrusted recording document');
    return start({ id: tab.id }, { expectedRoom, documentId, contentInvocation: true });
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
    if (pendingMicrophone && (!Number.isInteger(tabId) || pendingMicrophone.tabId === tabId)) await cancelMicrophone();
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
    if (pendingMicrophone && current.state.status === 'waiting-microphone' && !message.active) return { ok: true, ignored: true };
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
    if (pendingMicrophone?.tabId === tabId) await cancelMicrophone();
    try { await stop(tabId); }
    catch { /* stop already saved the visible failure; preserve acknowledged chunks */ }
    await interruptTab(tabId);
  };
  async function microphoneReady(helperTabId) {
    await load();
    // The helper can acquire a remembered grant before tabs.create has returned
    // to the worker. Do not mistake that legitimate first response for a spoof.
    if (microphoneRegistration) await microphoneRegistration;
    const waiting = pendingMicrophone;
    if (!waiting || waiting.helperTabId !== helperTabId) throw Error('Untrusted or canceled microphone permission request');
    await chrome.storage.local?.set({ [MICROPHONE_READY]: true });
    if (!Number.isInteger(waiting.tabId)) {
      await saveMicrophonePending(null);
      return { ok: true, resumed: false };
    }
    let target;
    try { target = await chrome.tabs.get(waiting.tabId); } catch { /* handled as a changed/closed room */ }
    let room;
    try { const url = new URL(target?.url); room = `${url.origin}${url.pathname.replace(/\/$/, '')}`; } catch { /* validated below */ }
    if (room !== waiting.meetingUrl) {
      await cancelMicrophone();
      throw Error('Cuộc họp đang chờ đã đóng hoặc đổi phòng.');
    }
    const result = await start(target, {
      microphoneAuthorized: true, permissionHandoff: true, microphoneRequest: waiting,
      expectedRoom: waiting.meetingUrl, documentId: waiting.documentId ?? null, contentInvocation: Boolean(waiting.documentId),
    });
    if (pendingMicrophone !== waiting) throw Error('Microphone permission request was canceled');
    if (!result.active || result.state.status !== 'recording') throw Error(result.state?.error || 'Không thể tiếp tục ghi âm cuộc họp.');
    await saveMicrophonePending(null);
    await chrome.tabs.update(target.id, { active: true });
    if (Number.isInteger(target.windowId)) await chrome.windows.update(target.windowId, { focused: true });
    return { ...result, resumed: true };
  }
  async function tabClosed(tabId) {
    await load();
    if (pendingMicrophone?.helperTabId === tabId) {
      const waiting = pendingMicrophone;
      const handingOff = pendingStart?.microphoneRequest === waiting || waiting.resumingCaptureId && current.captureId === waiting.resumingCaptureId;
      await cancelMicrophone();
      if (handingOff) await stop(waiting.tabId);
      return;
    }
    return ended(tabId);
  }
  return { start, startFromContent, stop, status, onState, tabClosed, tabNavigated: ended, openMicrophone, microphoneReady };
}

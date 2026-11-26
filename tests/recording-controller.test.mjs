import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRecordingController } from '../recording-controller.js';

const room = 'https://meet.google.com/abc-defg-hij';
function fixture({ permission = 'granted' } = {}) {
  const values = {}, localValues = {}, messages = [], broadcasts = [], opened = [], interrupted = [], activated = [];
  const helpers = new Map();
  let exists = false, activeTab = { id: 7, url: room, title: 'Team sync', active: true }, streamCalls = 0;
  let snapshot = { state: { status: 'idle' }, active: false, tabId: null, meetingUrl: null, captureId: null };
  const chrome = {
    storage: {
      session: { async get(key) { return structuredClone({ [key]: values[key] }); }, async set(data) { Object.assign(values, structuredClone(data)); }, async remove(key) { delete values[key]; } },
      local: { async get(key) { return structuredClone({ [key]: localValues[key] }); }, async set(data) { Object.assign(localValues, structuredClone(data)); } },
    },
    runtime: {
      id: 'extension', getURL: path => `chrome-extension://extension/${path}`,
      async getContexts() { return exists ? [{}] : []; },
      async sendMessage(message) {
        messages.push(message);
        if (message.type === 'recording.offscreen.permissions') return { ok: true, microphone: permission };
        if (message.type === 'recording.offscreen.status') return { ok: true, ...snapshot };
        if (message.type === 'recording.offscreen.start') {
          const metadata = message.metadata;
          snapshot = { state: { status: 'recording', id: 'file-1', startedAt: '2026-11-26T12:00:00Z' }, active: true, tabId: metadata.tabId, meetingUrl: metadata.meetingUrl, captureId: metadata.captureId };
          return { ok: true, ...snapshot };
        }
        if (message.type === 'recording.offscreen.stop') {
          snapshot = { ...snapshot, state: { status: 'saved', id: 'file-1' }, active: false };
          return { ok: true, ...snapshot };
        }
        throw Error(`Unexpected message ${message.type}`);
      },
    },
    offscreen: { async createDocument(options) { assert.deepEqual(options.reasons, ['USER_MEDIA']); exists = true; } },
    tabCapture: { async getMediaStreamId(options) { assert.equal(options.targetTabId, activeTab.id); streamCalls++; return `stream-${streamCalls}`; } },
    commands: { async getAll() { return [{ name: 'record-meeting', shortcut: 'Alt+Shift+R' }]; } },
    tabs: {
      async query() { return [activeTab]; },
      async get(id) { if (id === activeTab.id) return activeTab; if (helpers.has(id)) return helpers.get(id); throw Error('Tab closed'); },
      async create(options) { opened.push(options); const helper = { id: 90 + opened.length, url: options.url }; helpers.set(helper.id, helper); return helper; },
      async update(id, options) { activated.push({ id, ...options }); return { id }; },
      async sendMessage(tabId, message) {
        if (message.type === 'meet.status') return { inCall: true, meetingUrl: activeTab.url, title: activeTab.title };
        broadcasts.push({ tabId, message });
      },
    },
  };
  const make = () => createRecordingController(chrome, { interruptTab: async tabId => interrupted.push(tabId) });
  return { chrome, make, messages, broadcasts, opened, interrupted, activated, values, localValues,
    streams: () => streamCalls, snapshot: () => snapshot,
    setActiveTab(tab) { activeTab = tab; }, setExists(value) { exists = value; },
  };
}

test('invoked start uses a fresh tab stream ID and offscreen USER_MEDIA; stop preserves final result', async () => {
  const f = fixture(), controller = f.make();
  const started = await controller.start();
  assert.equal(started.state.status, 'recording');
  assert.equal(started.shortcut, 'Alt+Shift+R');
  assert.equal(f.streams(), 1);
  const metadata = f.messages.find(m => m.type === 'recording.offscreen.start').metadata;
  assert.deepEqual({ ...metadata, captureId: 'generated' }, { streamId: 'stream-1', tabId: 7, documentId: null, meetingUrl: room, title: 'Team sync', captureId: 'generated' });
  assert.ok(metadata.captureId);
  assert.equal((await controller.stop(7)).state.status, 'saved');
  await controller.start();
  assert.equal(f.streams(), 2);
});

test('missing microphone permission waits once then hands off original Meet capture after worker recreation', async () => {
  const f = fixture({ permission: 'prompt' });
  const waiting = await f.make().start();
  assert.equal(waiting.state.status, 'waiting-microphone');
  assert.equal(waiting.active, false);
  assert.equal(f.streams(), 0);
  assert.deepEqual(f.opened, [{ url: 'chrome-extension://extension/microphone.html' }]);
  const restarted = f.make();
  await assert.rejects(restarted.microphoneReady(999), /permission|quyền|pending|chờ|Untrusted/i);
  const result = await restarted.microphoneReady(91);
  assert.equal(result.resumed, true);
  assert.equal(result.state.status, 'recording');
  assert.equal(f.streams(), 1);
  assert.equal(f.messages.find(message => message.type === 'recording.offscreen.start').metadata.microphoneAuthorized, true);
  assert.deepEqual(f.activated.at(-1), { id: 7, active: true });
  await restarted.stop(7);
  const repeat = await restarted.start();
  assert.equal(repeat.state.status, 'recording');
  assert.equal(f.opened.length, 1, 'subsequent invocation must not reopen permission UI');
});

test('microphone handoff never follows a changed room or a canceled original request', async () => {
  const f = fixture({ permission: 'prompt' }), controller = f.make();
  await controller.start();
  f.setActiveTab({ id: 7, url: 'https://meet.google.com/xxx-yyyy-zzz', active: true });
  await assert.rejects(controller.microphoneReady(91), /cuộc họp|room|changed/i);
  assert.equal(f.streams(), 0);
  const canceled = fixture({ permission: 'prompt' }), other = canceled.make();
  await other.start();
  await other.stop(7);
  await assert.rejects(other.microphoneReady(91), /permission|quyền|pending|chờ|Untrusted/i);
  assert.equal(f.streams(), 0);
  assert.equal(canceled.streams(), 0);
});

test('microphone helper closed before granting cancels the pending request', async () => {
  const f = fixture({ permission: 'prompt' }), controller = f.make();
  await controller.start();
  await controller.tabClosed(91);
  assert.equal((await controller.status(7)).state.status, 'idle');
  await assert.rejects(controller.microphoneReady(91));
  assert.equal(f.streams(), 0);
});

test('Stop during helper registration cannot publish waiting or revive the canceled capture', async () => {
  const f = fixture({ permission: 'prompt' }), controller = f.make(), create = f.chrome.tabs.create;
  let releaseCreate;
  f.chrome.tabs.create = async options => {
    const helper = await create(options);
    await new Promise(resolve => { releaseCreate = resolve; });
    return helper;
  };
  const starting = controller.start();
  while (!releaseCreate) await new Promise(resolve => setImmediate(resolve));
  await controller.stop(7);
  releaseCreate();
  assert.equal((await starting).state.status, 'idle');
  await assert.rejects(controller.microphoneReady(91));
  assert.equal(f.streams(), 0);
});

test('fast automatic microphone ready waits for helper registration before validating its sender', async () => {
  const f = fixture({ permission: 'prompt' }), controller = f.make(), create = f.chrome.tabs.create;
  let releaseCreate;
  f.chrome.tabs.create = async options => {
    const helper = await create(options);
    await new Promise(resolve => { releaseCreate = resolve; });
    return helper;
  };
  const starting = controller.start();
  while (!releaseCreate) await new Promise(resolve => setImmediate(resolve));
  const ready = controller.microphoneReady(91).catch(error => ({ error: error.message }));
  releaseCreate();
  await starting;
  assert.equal((await ready).state?.status, 'recording');
  assert.equal(f.streams(), 1);
});

test('helper cancellation while target lookup is pending prevents a late queued capture', async () => {
  const f = fixture({ permission: 'prompt' }), controller = f.make(), get = f.chrome.tabs.get;
  await controller.start();
  let releaseLookup, waiting = true;
  f.chrome.tabs.get = async id => {
    if (id === 7 && waiting) {
      waiting = false;
      await new Promise(resolve => { releaseLookup = resolve; });
    }
    return get(id);
  };
  const ready = controller.microphoneReady(91).catch(error => error);
  while (!releaseLookup) await new Promise(resolve => setImmediate(resolve));
  await controller.tabClosed(91);
  releaseLookup();
  assert.match((await ready).message, /cancel|hủy/i);
  assert.equal(f.streams(), 0);
  assert.equal(f.snapshot().active, false);
});

test('closing helper during offscreen acquisition stops the handoff before returning a canceled error', async () => {
  const f = fixture({ permission: 'prompt' }), controller = f.make(), send = f.chrome.runtime.sendMessage;
  await controller.start();
  let releaseStart;
  f.chrome.runtime.sendMessage = async message => {
    const result = await send(message);
    if (message.type === 'recording.offscreen.start') await new Promise(resolve => { releaseStart = resolve; });
    return result;
  };
  const ready = controller.microphoneReady(91).catch(error => error);
  while (!releaseStart) await new Promise(resolve => setImmediate(resolve));
  await controller.tabClosed(91);
  const stillActive = f.snapshot().active;
  releaseStart();
  assert.match((await ready).message, /cancel|hủy/i);
  assert.equal(stillActive, false);
  assert.equal(f.snapshot().active, false);
});

test('a replacement worker can identify and stop the handoff when its helper closes', async () => {
  const f = fixture({ permission: 'prompt' }), controller = f.make(), send = f.chrome.runtime.sendMessage;
  await controller.start();
  let releaseStart;
  f.chrome.runtime.sendMessage = async message => {
    const result = await send(message);
    if (message.type === 'recording.offscreen.start') await new Promise(resolve => { releaseStart = resolve; });
    return result;
  };
  const ready = controller.microphoneReady(91).catch(error => error);
  while (!releaseStart) await new Promise(resolve => setImmediate(resolve));
  const replacement = f.make();
  await replacement.tabClosed(91);
  const stillActive = f.snapshot().active;
  // Settle the abandoned worker's test RPC; only the replacement owns the event.
  releaseStart(); await ready;
  assert.equal(stillActive, false);
});

test('revoked microphone opens one recovery helper and a failed handoff never reopens helpers in a loop', async () => {
  const f = fixture(), controller = f.make(), original = f.chrome.runtime.sendMessage;
  await controller.start();
  await controller.stop(7);
  f.chrome.runtime.sendMessage = async message => {
    if (message.type === 'recording.offscreen.start') return {
      ok: true, active: false, tabId: 7, meetingUrl: room, captureId: message.metadata.captureId,
      state: { status: 'error', error: 'Microphone permission revoked', needsMicrophone: true },
    };
    return original(message);
  };
  assert.equal((await controller.start()).state.status, 'waiting-microphone');
  assert.equal(f.opened.length, 1);
  await assert.rejects(controller.microphoneReady(91), /revoked/);
  assert.equal(f.opened.length, 1, 'failed handoff must leave its own helper available for an explicit retry');
  assert.equal(f.localValues['recording-microphone-ready'], false);
});

test('worker recreation reconciles an active offscreen recording instead of interrupting it', async () => {
  const f = fixture();
  await f.make().start();
  const restarted = f.make();
  assert.equal((await restarted.status(7)).state.status, 'recording');
  assert.equal(f.interrupted.length, 0);
  assert.equal(f.streams(), 1);
});

test('only one session is active and another Meet tab sees no private recording details', async () => {
  const f = fixture(), controller = f.make();
  await controller.start();
  assert.equal((await controller.start()).state.status, 'recording');
  assert.equal(f.streams(), 1);
  f.setActiveTab({ id: 8, url: 'https://meet.google.com/xxx-yyyy-zzz', active: true });
  await assert.rejects(controller.start(), /khác/);
  const own = await controller.status(8);
  assert.equal(own.state.status, 'idle');
  assert.equal(own.meetingUrl, null);
  assert.equal(own.tabId, null);
  await controller.stop(8);
  assert.equal(f.snapshot().active, true);
});

test('stream acquisition failure clears active slot and a later invocation can retry', async () => {
  const f = fixture(), controller = f.make();
  const real = f.chrome.tabCapture.getMediaStreamId;
  f.chrome.tabCapture.getMediaStreamId = async () => { throw Error('Not invoked'); };
  await assert.rejects(controller.start(), /Not invoked/);
  assert.equal((await controller.status(7)).active, false);
  f.chrome.tabCapture.getMediaStreamId = real;
  assert.equal((await controller.start()).state.status, 'recording');
});

test('state broadcasts require exact offscreen sender and reject an old capture ID', async () => {
  const f = fixture(), controller = f.make();
  await controller.start();
  const current = f.snapshot();
  const message = { type: 'recording.state', target: 'background', ...current, state: { status: 'saved' }, active: false };
  await assert.rejects(controller.onState(message, { id: 'extension', url: room }));
  await controller.onState({ ...message, captureId: 'old-session' }, { id: 'extension', url: 'chrome-extension://extension/offscreen.html' });
  assert.equal((await controller.status(7)).state.status, 'recording');
  await controller.onState(message, { id: 'extension', url: 'chrome-extension://extension/offscreen.html' });
  assert.equal(f.broadcasts.at(-1).message.state.status, 'saved');
});

test('tab navigation and closure stop the offscreen capture before fallback interruption', async () => {
  const f = fixture(), controller = f.make();
  await controller.start();
  await controller.tabNavigated(8);
  assert.equal(f.snapshot().active, true);
  await controller.tabClosed(7);
  assert.equal(f.snapshot().active, false);
  assert.equal(f.messages.at(-1).type, 'recording.offscreen.stop');
});

test('stop during the permission check prevents late tab capture acquisition', async () => {
  const f = fixture(), controller = f.make(), original = f.chrome.runtime.sendMessage;
  let resolvePermission;
  f.chrome.runtime.sendMessage = async message => {
    if (message.type === 'recording.offscreen.permissions') return new Promise(resolve => { resolvePermission = resolve; });
    return original(message);
  };
  const starting = controller.start();
  while (!resolvePermission) await new Promise(resolve => setImmediate(resolve));
  const pending = await controller.status(7);
  assert.equal(pending.active, true);
  assert.equal(pending.state.status, 'starting');
  await controller.stop(7);
  resolvePermission({ ok: true, microphone: 'granted' });
  const result = await starting;
  assert.equal(f.streams(), 0);
  assert.equal(result.active, false);
  assert.equal(result.state.status, 'idle');
});

test('failed stop closes the owned offscreen document before marking stored capture interrupted', async () => {
  const f = fixture(), controller = f.make(), original = f.chrome.runtime.sendMessage;
  await controller.start();
  let closed = false;
  f.chrome.offscreen.closeDocument = async () => { closed = true; f.setExists(false); };
  f.chrome.runtime.sendMessage = async message => {
    if (message.type === 'recording.offscreen.stop') throw Error('Channel disconnected');
    return original(message);
  };
  await assert.rejects(controller.stop(7), /Channel disconnected/);
  assert.equal(closed, true);
  assert.deepEqual(f.interrupted, [7]);
  assert.equal((await controller.status(7)).active, false);
});

test('offscreen status RPC failure cannot prevent Stop from releasing its media owner', async () => {
  const f = fixture(), controller = f.make(), original = f.chrome.runtime.sendMessage;
  await controller.start();
  let closed = false;
  f.chrome.offscreen.closeDocument = async () => { closed = true; f.setExists(false); };
  f.chrome.runtime.sendMessage = async message => {
    if (message.type === 'recording.offscreen.status') throw Error('Status channel disconnected');
    return original(message);
  };
  await assert.rejects(controller.stop(7), /Status channel disconnected/);
  assert.equal(closed, true);
  assert.deepEqual(f.interrupted, [7]);
});

test('pending startup status remains readable and Stop failure releases its offscreen document', async () => {
  const f = fixture(), controller = f.make(), original = f.chrome.runtime.sendMessage;
  let releaseStart;
  f.chrome.runtime.sendMessage = async message => {
    if (message.type === 'recording.offscreen.start') return new Promise(resolve => { releaseStart = resolve; });
    if (message.type === 'recording.offscreen.stop') throw Error('Stop channel disconnected');
    return original(message);
  };
  const starting = controller.start();
  while (!releaseStart) await new Promise(resolve => setImmediate(resolve));
  const status = await Promise.race([controller.status(7), new Promise(resolve => setTimeout(() => resolve('blocked'), 30))]);
  assert.notEqual(status, 'blocked');
  assert.equal(status.active, true);
  let closed = false;
  f.chrome.offscreen.closeDocument = async () => { closed = true; f.setExists(false); releaseStart({ ok: false, error: 'Owner closed' }); };
  await assert.rejects(controller.stop(7), /Stop channel disconnected/);
  await assert.rejects(starting, /Owner closed/);
  assert.equal(closed, true);
});

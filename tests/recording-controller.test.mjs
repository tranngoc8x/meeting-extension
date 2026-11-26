import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRecordingController } from '../recording-controller.js';

const room = 'https://meet.google.com/abc-defg-hij';
function fixture({ permission = 'granted' } = {}) {
  const values = {}, messages = [], broadcasts = [], opened = [], interrupted = [];
  let exists = false, activeTab = { id: 7, url: room, title: 'Team sync', active: true }, streamCalls = 0;
  let snapshot = { state: { status: 'idle' }, active: false, tabId: null, meetingUrl: null, captureId: null };
  const chrome = {
    storage: { session: { async get(key) { return { [key]: values[key] }; }, async set(data) { Object.assign(values, data); } } },
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
      async query() { return [activeTab]; }, async get() { return activeTab; }, async create(options) { opened.push(options); },
      async sendMessage(tabId, message) {
        if (message.type === 'meet.status') return { inCall: true, meetingUrl: activeTab.url, title: activeTab.title };
        broadcasts.push({ tabId, message });
      },
    },
  };
  const make = () => createRecordingController(chrome, { interruptTab: async tabId => interrupted.push(tabId) });
  return { chrome, make, messages, broadcasts, opened, interrupted, values,
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

test('missing extension microphone permission opens setup without acquiring tab audio', async () => {
  const f = fixture({ permission: 'prompt' });
  await assert.rejects(f.make().start(), error => error.needsMicrophone === true);
  assert.equal(f.streams(), 0);
  assert.deepEqual(f.opened, [{ url: 'chrome-extension://extension/microphone.html' }]);
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

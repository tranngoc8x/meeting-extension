import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOffscreenRecorder } from '../offscreen.js';

const sender = { id: 'fixture', url: 'chrome-extension://fixture/background.js' };
const metadata = { captureId: 'capture-1', streamId: 'tab-stream', tabId: 7, documentId: null, meetingUrl: 'https://meet.google.com/abc-defg-hij', title: 'Daily' };
function fixture({ held = false, permission = 'granted', heldPermission = false, permissionError = false } = {}) {
  const records = new Map(), chunks = [], broadcasts = [];
  let release, releasePermission, starts = 0;
  const store = {
    async interruptTab() {},
    async begin(record) { records.set(record.id, { ...record, status: 'recording' }); },
    async append(id, sequence, blob) { chunks.push({ id, sequence, blob }); },
    async finish(id, patch) { records.set(id, { ...records.get(id), ...patch }); },
  };
  const chrome = { runtime: { id: 'fixture', getURL: p => `chrome-extension://fixture/${p}`, async sendMessage(message) { broadcasts.push(message); } } };
  const recorderFactory = ({ send, onState }) => {
    let state = { status: 'idle' };
    const publish = value => { state = value; onState(value); };
    return {
      getState: () => state,
      async start(meta) {
        starts++; publish({ status: 'starting' });
        if (held) await new Promise(resolve => { release = resolve; });
        await send({ type: 'recording.begin', id: 'record-1', title: meta.title, meetingUrl: meta.meetingUrl, startedAt: '2026-11-26T12:00:00Z', mimeType: 'audio/webm' });
        publish({ status: 'recording', id: 'record-1' });
      },
      async stop() {
        if (state.status !== 'recording') { publish({ status: 'idle' }); return; }
        await send({ type: 'recording.chunk', id: 'record-1', sequence: 0, data: 'YWJj' });
        await send({ type: 'recording.finish', id: 'record-1', endedAt: '2026-11-26T12:00:05Z' });
        publish({ status: 'saved', id: 'record-1' });
      },
    };
  };
  const router = createOffscreenRecorder({ chrome, store, recorderFactory, permissions: { async query() {
    if (permissionError) throw Error('Permission query failed');
    if (heldPermission) await new Promise(resolve => { releasePermission = resolve; });
    return { state: permission };
  } } });
  return { router, records, chunks, broadcasts, starts: () => starts, release: () => release(), releasePermission: () => releasePermission() };
}
const message = (type, extra) => ({ target: 'offscreen', type: `recording.offscreen.${type}`, ...extra });

test('offscreen persists chunks in extension storage and retains identity/state for a restarted worker', async () => {
  const f = fixture();
  await f.router.handle(message('start', { metadata }), sender);
  const active = await f.router.handle(message('status'), sender);
  assert.equal(active.state.status, 'recording'); assert.equal(active.captureId, 'capture-1'); assert.equal(active.active, true);
  await f.router.handle(message('stop'), sender);
  const saved = await f.router.handle(message('status'), sender);
  assert.equal(saved.state.status, 'saved'); assert.equal(saved.active, false);
  assert.equal(f.records.get('record-1').tabId, 7);
  assert.equal(f.records.get('record-1').documentId, null);
  assert.equal(f.records.get('record-1').status, 'pending-upload');
  assert.equal(await f.chunks[0].blob.text(), 'abc');
  assert.ok(f.broadcasts.every(m => m.target === 'background' && m.type === 'recording.state' && m.captureId === 'capture-1'));
});

test('offscreen refuses content scripts and unrelated extension pages before touching media', async () => {
  const f = fixture();
  for (const untrusted of [{ ...sender, id: 'other' }, { ...sender, tab: { id: 7 } }, { ...sender, url: 'chrome-extension://fixture/popup.html' }, { ...sender, url: 'https://meet.google.com/abc-defg-hij' }]) {
    await assert.rejects(f.router.handle(message('start', { metadata }), untrusted));
  }
  assert.equal(f.starts(), 0);
});

test('a pending start cannot be replaced with metadata from another capture', async () => {
  const f = fixture({ held: true });
  const first = f.router.handle(message('start', { metadata }), sender);
  await assert.rejects(f.router.handle(message('start', { metadata: { ...metadata, captureId: 'capture-2', tabId: 8, title: 'Other' } }), sender));
  const pending = await f.router.handle(message('status'), sender);
  assert.equal(pending.active, true); assert.equal(pending.captureId, 'capture-1');
  f.release(); await first;
  assert.equal(f.records.get('record-1').title, 'Daily');
  assert.equal(f.records.get('record-1').tabId, 7);
});

test('permission query is side-effect free and a malformed start cannot open capture', async () => {
  const f = fixture();
  assert.deepEqual(await f.router.handle(message('permissions'), sender), { ok: true, microphone: 'granted' });
  await assert.rejects(f.router.handle(message('start', { metadata: { ...metadata, meetingUrl: 'https://evil.test/' } }), sender));
  assert.equal(f.starts(), 0);
});

test('missing microphone permission never starts tab acquisition and is visible to the worker', async () => {
  const f = fixture({ permission: 'prompt' });
  await assert.rejects(f.router.handle(message('start', { metadata }), sender));
  const status = await f.router.handle(message('status'), sender);
  assert.equal(status.state.status, 'error');
  assert.equal(status.state.needsMicrophone, true);
  assert.equal(status.active, false); assert.equal(f.starts(), 0);
});

test('trusted visible microphone handoff attempts real acquisition even when permission query remains prompt', async () => {
  const f = fixture({ permission: 'prompt' });
  const result = await f.router.handle(message('start', { metadata: { ...metadata, microphoneAuthorized: true } }), sender);
  assert.equal(result.state.status, 'recording');
  assert.equal(f.starts(), 1);
});

test('stop during a pending permission check cannot start capture after the check resolves', async () => {
  const f = fixture({ heldPermission: true });
  const first = f.router.handle(message('start', { metadata }), sender);
  await f.router.handle(message('stop'), sender);
  f.releasePermission(); await first;
  const status = await f.router.handle(message('status'), sender);
  assert.equal(f.starts(), 0);
  assert.equal(status.state.status, 'idle');
  assert.equal(status.active, false);
});

test('permission query failure is an error rather than a stale saved or idle state', async () => {
  const f = fixture({ permissionError: true });
  await assert.rejects(f.router.handle(message('start', { metadata }), sender), /Permission query failed/);
  const status = await f.router.handle(message('status'), sender);
  assert.equal(status.state.status, 'error');
  assert.match(status.state.error, /Permission query failed/);
  assert.equal(f.starts(), 0);
});

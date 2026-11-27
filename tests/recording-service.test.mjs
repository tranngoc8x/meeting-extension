import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRecordingService } from '../recording-service.js';
const room = 'https://meet.google.com/abc-defg-hij';
const content = { id: 'extension', frameId: 0, documentId: 'document-1', tab: { id: 7 }, url: room };
const popup = { id: 'extension', url: 'chrome-extension://extension/popup.html' };
function fixture() {
  const calls = [];
  const controller = Object.fromEntries(['start', 'startFromContent', 'stop', 'setMicrophoneMuted', 'status', 'openMicrophone', 'onState', 'microphoneReady'].map(name => [name, async (...args) => { calls.push([name, ...args]); return { ok: true, state: { status: 'idle' } }; }]));
  const handle = createRecordingService({ controller, runtimeId: 'extension', getURL: path => `chrome-extension://extension/${path}`, openLibrary: async () => { calls.push(['library']); }, openSettings: async () => { calls.push(['settings']); } });
  return { handle, calls };
}
test('trusted controls may start; content cannot upload chunks or spoof another tab', async () => {
  const f = fixture();
  for (const sender of [{ ...content, frameId: 2 }, { ...popup, id: 'other' }, { ...popup, url: 'chrome-extension://extension/recordings.html' }]) {
    await assert.rejects(f.handle({ type: 'recording.start', tabId: 99 }, sender));
  }
  assert.equal(await f.handle({ type: 'recording.chunk' }, content), undefined);
  await f.handle({ type: 'recording.start', tabId: 99 }, popup);
  assert.deepEqual(f.calls, [['start']]);
});

test('floating Start uses only the actual sender tab, URL and document instead of caller-supplied identities', async () => {
  const f = fixture();
  await f.handle({ type: 'recording.start', tabId: 99, meetingUrl: 'https://meet.google.com/xxx-yyyy-zzz', documentId: 'spoofed' }, content);
  assert.deepEqual(f.calls, [['startFromContent', { id: 7 }, room, 'document-1']]);
});
test('Meet status and stop always use sender tab identity and reject non-top-frame/untrusted messages', async () => {
  const f = fixture();
  for (const sender of [{ ...content, frameId: 2 }, { ...content, url: 'https://evil.test/' }, { ...content, documentId: undefined }]) {
    await assert.rejects(f.handle({ type: 'recording.stop' }, sender));
  }
  await f.handle({ type: 'recording.status', tabId: 99 }, content);
  await f.handle({ type: 'recording.stop', tabId: 99 }, content);
  assert.deepEqual(f.calls, [['status', 7], ['stop', 7]]);
});
test('Meet mute updates only the active recording microphone', async () => {
  const f = fixture();
  await f.handle({ type: 'recording.microphone-muted', muted: true }, content);
  assert.deepEqual(f.calls, [['setMicrophoneMuted', 7, true]]);
});
test('popup can stop global recording/open permissions; library is available from trusted Meet', async () => {
  const f = fixture();
  await f.handle({ type: 'recording.stop' }, popup);
  await f.handle({ type: 'microphone.open' }, popup);
  await f.handle({ type: 'recordings.open' }, content);
  assert.deepEqual(f.calls, [['stop'], ['openMicrophone'], ['library']]);
});
test('state messages go through controller offscreen validation and never trigger start', async () => {
  const f = fixture(), sender = { id: 'extension', url: 'chrome-extension://extension/offscreen.html' };
  const message = { target: 'background', type: 'recording.state', state: { status: 'recording' } };
  await f.handle(message, sender);
  assert.deepEqual(f.calls, [['onState', message, sender]]);
});

test('only the extension microphone helper can acknowledge acquisition, using its actual sender tab', async () => {
  const f = fixture();
  for (const sender of [content, popup, { id: 'other', frameId: 0, tab: { id: 91 }, url: 'chrome-extension://extension/microphone.html' }]) {
    await assert.rejects(f.handle({ type: 'recording.microphone-ready', tabId: 7 }, sender));
  }
  await f.handle({ type: 'recording.microphone-ready', tabId: 7 }, { id: 'extension', frameId: 0, tab: { id: 91 }, url: 'chrome-extension://extension/microphone.html' });
  assert.deepEqual(f.calls, [['microphoneReady', 91]]);
});

test('settings retain trusted extension controls as a tab and Meet can open settings', async () => {
  const f = fixture();
  await f.handle({ type: 'recording.status' }, { ...popup, tab: { id: 20 } });
  await f.handle({ type: 'settings.open' }, content);
  assert.deepEqual(f.calls, [['status'], ['settings']]);
});

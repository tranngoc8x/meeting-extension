import { test } from 'node:test';
import assert from 'node:assert/strict';

test('one toolbar click starts Meet recording and the next stops it; other tabs open settings', async t => {
  const previous = globalThis.chrome;
  t.after(() => { globalThis.chrome = previous; });
  const values = {}, actions = [], calls = [];
  let exists = false, snapshot = { state: { status: 'idle' }, active: false };
  const tab = { id: 7, url: 'https://meet.google.com/abc-defg-hij', title: 'Team sync' };
  const event = () => ({ addListener() {} });
  const storage = { get: async key => ({ [key]: values[key] }), set: async data => Object.assign(values, data), remove: async () => {}, setAccessLevel: async () => {} };
  globalThis.chrome = {
    storage: { local: storage, session: storage },
    runtime: { id: 'extension', getURL: path => `chrome-extension://extension/${path}`, onMessage: event(), onStartup: event(), onInstalled: event(),
      openOptionsPage: async () => { calls.push('settings'); },
      getContexts: async () => exists ? [{}] : [],
      sendMessage: async message => {
        calls.push(message.type);
        if (message.type.endsWith('.permissions')) return { ok: true, microphone: 'granted' };
        if (message.type.endsWith('.start')) snapshot = { state: { status: 'recording' }, active: true, tabId: 7, meetingUrl: tab.url, captureId: message.metadata.captureId };
        if (message.type.endsWith('.stop')) snapshot = { ...snapshot, state: { status: 'saved' }, active: false };
        return { ok: true, ...snapshot };
      },
    },
    action: { onClicked: { addListener: listener => actions.push(listener) } },
    commands: { onCommand: event(), getAll: async () => [] },
    offscreen: { createDocument: async () => { exists = true; } },
    tabCapture: { getMediaStreamId: async () => 'tab-stream' },
    tabs: { onRemoved: event(), onUpdated: event(), get: async () => tab, query: async () => [tab], sendMessage: async (_id, message) => message.type === 'meet.status' ? { inCall: true, meetingUrl: tab.url, title: tab.title } : undefined },
  };
  await import('../background.js?one-click-action');
  assert.equal(actions.length, 1, 'toolbar invocation must have a direct recording handler');
  await actions[0](tab);
  assert.equal(calls.filter(type => type === 'recording.offscreen.start').length, 1);
  assert.equal(snapshot.active, true);
  await actions[0](tab);
  assert.equal(calls.filter(type => type === 'recording.offscreen.stop').length, 1);
  assert.equal(snapshot.active, false);
  await actions[0]({ id: 9, url: 'https://example.test/' });
  assert.equal(calls.filter(type => type === 'settings').length, 1);
});

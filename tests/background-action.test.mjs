import { test } from 'node:test';
import assert from 'node:assert/strict';

test('July control popup starts and stops recording through the trusted background route', async t => {
  const previous = globalThis.chrome;
  t.after(() => { globalThis.chrome = previous; });
  const values = {}, listeners = [], calls = [];
  let exists = false, snapshot = { state: { status: 'idle' }, active: false };
  const tab = { id: 7, url: 'https://meet.google.com/abc-defg-hij', title: 'Team sync' };
  const event = () => ({ addListener() {} });
  const storage = { get: async key => ({ [key]: values[key] }), set: async data => Object.assign(values, data), remove: async () => {}, setAccessLevel: async () => {} };
  globalThis.chrome = {
    storage: { local: storage, session: storage },
    runtime: { id: 'extension', getURL: path => `chrome-extension://extension/${path}`, onMessage: { addListener: listener => listeners.push(listener) }, onStartup: event(), onInstalled: event(),
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
    action: { onClicked: event() },
    commands: { onCommand: event(), getAll: async () => [] },
    offscreen: { createDocument: async () => { exists = true; } },
    tabCapture: { getMediaStreamId: async () => 'tab-stream' },
    tabs: { onRemoved: event(), onUpdated: event(), get: async () => tab, query: async () => [tab], sendMessage: async (_id, message) => message.type === 'meet.status' ? { inCall: true, meetingUrl: tab.url, title: tab.title } : undefined },
  };
  await import('../background.js?control-popup');
  async function rpc(type) {
    return new Promise((resolve, reject) => {
      const keptOpen = listeners[2]({ type }, { id: 'extension', url: 'chrome-extension://extension/popup.html' }, result => result.ok ? resolve(result) : reject(Error(result.error)));
      assert.equal(keptOpen, true);
    });
  }
  await rpc('recording.start');
  assert.equal(calls.filter(type => type === 'recording.offscreen.start').length, 1);
  assert.equal(snapshot.active, true);
  await rpc('recording.stop');
  assert.equal(calls.filter(type => type === 'recording.offscreen.stop').length, 1);
  assert.equal(snapshot.active, false);
  await rpc('settings.open');
  assert.equal(calls.filter(type => type === 'settings').length, 1);
});

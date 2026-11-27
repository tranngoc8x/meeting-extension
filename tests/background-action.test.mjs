import { test } from 'node:test';
import assert from 'node:assert/strict';

test('toolbar directly starts and stops recording; settings controls remain available', async t => {
  const previous = globalThis.chrome;
  t.after(() => { globalThis.chrome = previous; });
  const values = {}, listeners = [], calls = [];
  let onAction, exists = false, snapshot = { state: { status: 'idle' }, active: false };
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
    action: {
      onClicked: { addListener: listener => { onAction = listener; } },
      setBadgeText: async value => { calls.push(['badge', value.text]); },
      setBadgeBackgroundColor: async value => { calls.push(['badge-color', value.color]); },
      setTitle: async value => { calls.push(['title', value.title]); },
    },
    commands: { onCommand: event(), getAll: async () => [] },
    offscreen: { createDocument: async () => { exists = true; } },
    tabCapture: { getMediaStreamId: async () => 'tab-stream' },
    tabs: { onRemoved: event(), onUpdated: event(), get: async () => tab, query: async () => [tab], sendMessage: async (_id, message) => message.type === 'meet.status' ? { inCall: true, meetingUrl: tab.url, title: tab.title } : undefined },
  };
  await import('../background.js?direct-action');
  async function rpc(type) {
    return new Promise((resolve, reject) => {
      const keptOpen = listeners[2]({ type }, { id: 'extension', url: 'chrome-extension://extension/popup.html' }, result => result.ok ? resolve(result) : reject(Error(result.error)));
      assert.equal(keptOpen, true);
    });
  }
  assert.equal(typeof onAction, 'function', 'toolbar action must register a recording handler');
  await onAction(tab);
  assert.equal(calls.filter(type => type === 'recording.offscreen.start').length, 1);
  assert.equal(snapshot.active, true);
  assert.ok(calls.some(call => call[0] === 'badge' && call[1] === '●'));
  await onAction(tab);
  assert.equal(calls.filter(type => type === 'recording.offscreen.stop').length, 1);
  assert.equal(snapshot.active, false);
  assert.ok(calls.some(call => call[0] === 'badge' && call[1] === ''));
  await rpc('settings.open');
  assert.equal(calls.filter(type => type === 'settings').length, 1);
});

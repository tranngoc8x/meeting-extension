import { test } from 'node:test';
import assert from 'node:assert/strict';

test('service worker polls meetings on the reminder alarm and creates a Chrome notification', async t => {
  const values = { backendConnection: { backendUrl: 'https://api.july.io.vn', token: 'saved-user-token' }, calendarReminderMinutes: 5 };
  const listeners = [];
  const alarmListeners = [];
  const clickListeners = [];
  const notifications = [];
  const opened = [];
  const cleared = [];
  const storage = {
    get: async key => key === null ? { ...values } : { [key]: values[key] },
    set: async updates => Object.assign(values, updates),
    remove: async keys => keys.forEach(key => delete values[key]),
    setAccessLevel: async () => {},
  };
  const previousChrome = globalThis.chrome;
  const previousFetch = globalThis.fetch;
  t.after(() => { globalThis.chrome = previousChrome; globalThis.fetch = previousFetch; });
  globalThis.chrome = {
    storage: { local: storage, sync: storage },
    runtime: {
      id: 'fixture',
      getURL: path => `chrome-extension://fixture/${path}`,
      onMessage: { addListener: fn => listeners.push(fn) },
      onStartup: { addListener: () => {} },
      onInstalled: { addListener: () => {} },
    },
    alarms: { create: () => {}, clear: async name => { cleared.push(name); return true; }, onAlarm: { addListener: fn => alarmListeners.push(fn) } },
    notifications: { create: async (id, options) => notifications.push({ id, options }), onClicked: { addListener: fn => clickListeners.push(fn) } },
    tabs: { onRemoved: { addListener: () => {} }, onUpdated: { addListener: () => {} }, create: async value => opened.push(value) },
    action: { onClicked: { addListener: () => {} } },
    commands: { onCommand: { addListener: () => {} } },
    offscreen: { hasDocument: async () => false, createDocument: async () => {} },
  };
  globalThis.fetch = async url => {
    assert.equal(url, 'https://api.july.io.vn/api/meetings');
    return Response.json({ meetings: [{ id: 'm1', title: 'Daily', meetCode: 'abc-defg-hij', startAt: new Date(Date.now() + 4.5 * 60_000).toISOString(), status: 'scheduled' }] });
  };
  const background = await import('../background.js?reminders-test');
  assert.equal(alarmListeners.length, 1);
  await alarmListeners[0]({ name: 'calendar-reminders' });
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].id, 'july-calendar-m1');
  await clickListeners[0]('july-calendar-m1');
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual(opened, [{ url: 'https://meet.google.com/abc-defg-hij' }]);
  globalThis.fetch = async () => new Response('{}', { status: 401 });
  await background.pollCalendarReminders();
  assert.ok(cleared.includes('calendar-reminders'));
  assert.equal(values['calendar-reminder:m1'], undefined);
});

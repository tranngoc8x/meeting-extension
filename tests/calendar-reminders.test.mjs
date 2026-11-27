import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_REMINDER_MINUTES,
  MAX_REMINDER_MINUTES,
  MIN_REMINDER_MINUTES,
  REMINDER_ALARM,
  REMINDER_MINUTES_KEY,
  clearCalendarReminders,
  normalizeReminderMinutes,
  syncCalendarReminders,
} from '../calendar-reminders.js';

function storage(initial = {}) {
  const data = { ...initial };
  return {
    data,
    async get(keys) {
      if (keys === null) return { ...data };
      const names = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(names.map(key => [key, data[key]]));
    },
    async set(values) { Object.assign(data, values); },
    async remove(keys) { for (const key of keys) delete data[key]; },
  };
}

test('normalizes reminder minutes to the supported 1-10 range', () => {
  assert.equal(normalizeReminderMinutes(undefined), DEFAULT_REMINDER_MINUTES);
  assert.equal(normalizeReminderMinutes('7'), 7);
  assert.equal(normalizeReminderMinutes(0), MIN_REMINDER_MINUTES);
  assert.equal(normalizeReminderMinutes(99), MAX_REMINDER_MINUTES);
  assert.equal(normalizeReminderMinutes('bad'), DEFAULT_REMINDER_MINUTES);
});

test('notifies a scheduled meeting once when its reminder window is due', async () => {
  const now = new Date('2026-11-27T10:00:30.000Z');
  const store = storage({ [REMINDER_MINUTES_KEY]: 5 });
  const notifications = [];
  const apiFn = async () => ({ meetings: [
    { id: 'm1', title: 'Daily', meetCode: 'abc-defg-hij', startAt: '2026-11-27T10:05:00.000Z', status: 'scheduled' },
  ] });
  const options = await syncCalendarReminders({ storage: store, apiFn, notifications: { create: async (id, value) => {
    assert.equal(store.data['calendar-reminder:m1'], '2026-11-27T10:05:00.000Z');
    notifications.push({ id, value });
  } }, now });
  assert.equal(options.notified, 1);
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].id, 'july-calendar-m1');
  assert.match(notifications[0].value.message, /5 phút/);
  assert.equal(store.data['calendar-reminder:m1'], '2026-11-27T10:05:00.000Z');
  await syncCalendarReminders({ storage: store, apiFn, notifications: { create: async () => notifications.push('duplicate') }, now });
  assert.equal(notifications.length, 1);
});

test('skips cancelled, invalid, and not-yet-due meetings', async () => {
  const store = storage({ [REMINDER_MINUTES_KEY]: 5 });
  const notifications = [];
  const result = await syncCalendarReminders({
    storage: store,
    apiFn: async () => ({ meetings: [
      { id: 'cancelled', startAt: '2026-11-27T10:05:00.000Z', status: 'cancelled' },
      { id: 'invalid', startAt: 'bad', status: 'scheduled' },
      { id: 'future', startAt: '2026-11-27T10:20:00.000Z', status: 'scheduled' },
    ] }),
    notifications: { create: async (...args) => notifications.push(args) },
    now: new Date('2026-11-27T10:00:00.000Z'),
  });
  assert.equal(result.notified, 0);
  assert.deepEqual(notifications, []);
});

test('clears reminder alarm and stored markers on logout', async () => {
  const store = storage({ 'calendar-reminder:m1': '2026-11-27T10:05:00.000Z', other: true });
  const cleared = [];
  await clearCalendarReminders(store, { clear: async name => cleared.push(name) });
  assert.deepEqual(cleared, [REMINDER_ALARM]);
  assert.equal(store.data['calendar-reminder:m1'], undefined);
  assert.equal(store.data.other, true);
});

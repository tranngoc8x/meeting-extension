import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SCHEDULE, loadSchedule, saveSchedule, validateSchedule } from '../schedule.js';
function storage(initial = {}) {
 const data = structuredClone(initial);
 return { data, get: async key => ({ [key]: structuredClone(data[key]) }), set: async values => Object.assign(data, structuredClone(values)) };
}
test('default is 08:30-18:30 Monday-Friday when nothing (or garbage) is stored', async () => {
 assert.deepEqual(await loadSchedule(storage()), { start: '08:30', end: '18:30', days: [1, 2, 3, 4, 5] });
 assert.deepEqual(await loadSchedule(storage({ scanSchedule: { start: 'x' } })), { ...DEFAULT_SCHEDULE, days: [1, 2, 3, 4, 5] });
});
test('save normalizes days and round-trips', async () => {
 const s = storage();
 await saveSchedule(s, { start: '07:45', end: '20:00', days: [6, 0, 6, 3] });
 assert.deepEqual(await loadSchedule(s), { start: '07:45', end: '20:00', days: [0, 3, 6] });
});
test('rejects bad times, reversed window, no days, out-of-range days', () => {
 for (const bad of [
  { start: '8:30', end: '18:30', days: [1] }, { start: '08:30', end: '24:00', days: [1] },
  { start: '18:30', end: '08:30', days: [1] }, { start: '08:30', end: '08:30', days: [1] },
  { start: '08:30', end: '18:30', days: [] }, { start: '08:30', end: '18:30', days: [7] }, null,
 ]) assert.throws(() => validateSchedule(bad));
});

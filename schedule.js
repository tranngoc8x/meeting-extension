// Calendar scan window. Stored locally until the backend exists to read it.
export const SCHEDULE_KEY = 'scanSchedule';
export const DEFAULT_SCHEDULE = Object.freeze({ start: '08:30', end: '18:30', days: Object.freeze([1, 2, 3, 4, 5]) });
// Date#getDay numbering, displayed Monday first.
export const WEEKDAYS = Object.freeze([[1, 'T2'], [2, 'T3'], [3, 'T4'], [4, 'T5'], [5, 'T6'], [6, 'T7'], [0, 'CN']]);
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function validateSchedule(value) {
  const { start, end, days } = value ?? {};
  if (!TIME.test(start) || !TIME.test(end)) throw new Error('Giờ không hợp lệ (HH:MM)');
  if (start >= end) throw new Error('Giờ bắt đầu phải trước giờ kết thúc');
  if (!Array.isArray(days) || days.some(day => !Number.isInteger(day) || day < 0 || day > 6)) throw new Error('Ngày không hợp lệ');
  const unique = [...new Set(days)].sort((a, b) => a - b);
  if (!unique.length) throw new Error('Chọn ít nhất một ngày');
  return { start, end, days: unique };
}

export async function loadSchedule(storage) {
  try {
    return validateSchedule((await storage.get(SCHEDULE_KEY))[SCHEDULE_KEY]);
  } catch {
    return { ...DEFAULT_SCHEDULE, days: [...DEFAULT_SCHEDULE.days] };
  }
}

export async function saveSchedule(storage, value) {
  const schedule = validateSchedule(value);
  await storage.set({ [SCHEDULE_KEY]: schedule });
  return schedule;
}

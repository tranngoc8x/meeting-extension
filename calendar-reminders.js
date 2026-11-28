import { DEFAULT_LANGUAGE, getMessages } from './i18n.js';

export const REMINDER_ALARM = 'calendar-reminders';
export const REMINDER_MINUTES_KEY = 'calendarReminderMinutes';
export const REMINDER_STATUS_KEY = 'calendarReminderStatus';
export const DEFAULT_REMINDER_MINUTES = 5;
export const MIN_REMINDER_MINUTES = 1;
export const MAX_REMINDER_MINUTES = 10;
const REMINDER_PREFIX = 'calendar-reminder:';
const NOTIFICATION_PREFIX = 'calendar-notification-url:';
const ALARM_TOLERANCE_MS = 90_000;

export function normalizeReminderMinutes(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || !Number.isInteger(number)) return DEFAULT_REMINDER_MINUTES;
  return Math.min(MAX_REMINDER_MINUTES, Math.max(MIN_REMINDER_MINUTES, number));
}

function reminderKey(meeting) {
  return `${REMINDER_PREFIX}${meeting.id}`;
}

function meetUrl(meetCode) {
  return typeof meetCode === 'string' && /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/i.test(meetCode)
    ? `https://meet.google.com/${meetCode}`
    : undefined;
}

function isDue(meeting, nowMs, reminderMinutes) {
  if (!meeting || meeting.status !== 'scheduled' || typeof meeting.id !== 'string' || !meeting.id) return false;
  const startMs = Date.parse(meeting.startAt);
  if (!Number.isFinite(startMs)) return false;
  const targetMs = startMs - reminderMinutes * 60_000;
  const elapsed = nowMs - targetMs;
  return elapsed >= 0 && elapsed < ALARM_TOLERANCE_MS && startMs > nowMs;
}

function notificationOptions(meeting, reminderMinutes, msg) {
  const title = meeting.title || msg.reminderDefaultMeeting;
  return {
    type: 'basic',
    title: msg.reminderTitle,
    message: msg.reminderBody(title, reminderMinutes),
    contextMessage: meeting.meetCode ? 'Google Meet' : 'Google Calendar',
    iconUrl: 'icons/icon128.png',
    priority: 2,
    data: { meetUrl: meetUrl(meeting.meetCode), meetingId: meeting.id },
  };
}

export async function syncCalendarReminders({ storage, apiFn, notifications, now = new Date(), reminderMinutes, language = DEFAULT_LANGUAGE } = {}) {
  const msg = getMessages(language);
  if (!storage || typeof apiFn !== 'function' || !notifications?.create) return { notified: 0 };
  const configured = reminderMinutes ?? (await storage.get(REMINDER_MINUTES_KEY))[REMINDER_MINUTES_KEY];
  const minutes = normalizeReminderMinutes(configured);
  let payload;
  try {
    payload = await apiFn();
  } catch (error) {
    return { notified: 0, error };
  }
  const meetings = Array.isArray(payload?.meetings) ? payload.meetings : [];
  const saved = await storage.get(null);
  let notified = 0;
  for (const meeting of meetings) {
    if (!isDue(meeting, now.getTime(), minutes) || saved[reminderKey(meeting)] !== undefined) continue;
    const id = `july-calendar-${meeting.id}`;
    await storage.set({ [reminderKey(meeting)]: meeting.startAt });
    try {
      await notifications.create(id, notificationOptions(meeting, minutes, msg));
    } catch (error) {
      await storage.remove([reminderKey(meeting)]);
      throw error;
    }
    notified += 1;
  }
  return { notified };
}

export async function clearCalendarReminders(storage, alarms) {
  await alarms?.clear?.(REMINDER_ALARM);
  if (!storage?.get || !storage?.remove) return;
  const saved = await storage.get(null);
  const keys = Object.keys(saved).filter(key => key.startsWith(REMINDER_PREFIX) || key.startsWith(NOTIFICATION_PREFIX));
  if (keys.length) await storage.remove(keys);
}

const ROOM = /^https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const tabKey = tabId => `meet-detection:${tabId}`;
export async function recordTransition(storage, tabId, event) {
  if (!Number.isInteger(tabId) || tabId < 0 || !event || typeof event.inCall !== 'boolean'
    || !ROOM.test(event.meetingUrl) || !UUID.test(event.requestId)
    || !Number.isFinite(Date.parse(event.detectedAt))) throw new Error('Invalid local transition');
  const key = tabKey(tabId);
  const previous = (await storage.get(key))[key];
  const sameEvent = previous?.inCall && event.inCall && previous.meetingUrl === event.meetingUrl;
  const stored = {
    schemaVersion: 1, tabId, provider: 'google_meet', meetingUrl: event.meetingUrl,
    inCall: event.inCall, requestId: sameEvent ? previous.requestId : event.requestId,
    detectedAt: sameEvent ? previous.detectedAt : event.detectedAt
  };
  await storage.set({[key]:stored});
  return stored;
}

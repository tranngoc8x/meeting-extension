const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ROOM = /^https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}$/;
export const RECORDING_MESSAGES = new Set(['recording.begin', 'recording.chunk', 'recording.finish', 'recordings.open']);

export function createRecordingService({ store, runtimeId, openLibrary }) {
  return async function handle(message, sender) {
    if (!RECORDING_MESSAGES.has(message?.type)) return;
    let room, origin;
    try {
      const url = new URL(sender.url);
      origin = url.origin;
      room = `${url.origin}${url.pathname.replace(/\/$/, '')}`;
    } catch { /* Rejected below. */ }
    if (sender.id !== runtimeId || sender.frameId !== 0 || !Number.isInteger(sender.tab?.id)
        || sender.tab.id < 0 || !sender.documentId || origin !== 'https://meet.google.com') throw Error('Untrusted recording sender');
    if (message.type === 'recordings.open') {
      await openLibrary();
      return { ok: true };
    }
    if (!UUID.test(message.id)) throw Error('Invalid recording ID');
    if (message.type === 'recording.begin') {
      if (!ROOM.test(room) || message.meetingUrl !== room || !['audio/webm', 'audio/webm;codecs=opus'].includes(message.mimeType)
          || typeof message.title !== 'string' || !Number.isFinite(Date.parse(message.startedAt))) throw Error('Invalid recording metadata');
      if (await store.get(message.id)) throw Error('Recording already exists');
      // A reload can leave an unfinished recording for this tab. Preserve its chunks.
      await store.interruptTab(sender.tab.id);
      await store.begin({
        id: message.id, tabId: sender.tab.id, documentId: sender.documentId,
        meetingUrl: room, title: message.title.trim().slice(0, 200) || room.split('/').at(-1),
        startedAt: message.startedAt, mimeType: message.mimeType,
      });
      return { ok: true };
    }
    const record = await store.get(message.id);
    // Same-document SPA navigation must still be able to flush the old room.
    // documentId changes on reload, so another document cannot append/finalize it.
    if (!record || record.tabId !== sender.tab.id || record.documentId !== sender.documentId) throw Error('Recording belongs to another document');
    if (message.type === 'recording.chunk') {
      if (!Number.isSafeInteger(message.sequence) || message.sequence < 0
          || typeof message.data !== 'string' || !message.data.length || message.data.length > 2 * 1024 * 1024
          || message.data.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(message.data)) throw Error('Invalid recording chunk');
      const bytes = Uint8Array.from(atob(message.data), character => character.charCodeAt(0));
      await store.append(message.id, message.sequence, new Blob([bytes], { type: record.mimeType }));
      return { ok: true };
    }
    if (!Number.isFinite(Date.parse(message.endedAt))) throw Error('Invalid recording end time');
    await store.finish(message.id, {
      endedAt: message.endedAt,
      status: message.error ? 'interrupted' : 'pending-upload',
      ...(message.error ? { error: String(message.error).slice(0, 300) } : {}),
    });
    return { ok: true };
  };
}

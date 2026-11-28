import { uploadToSignedUrl } from './signed-upload.js';

const ROOM = /^https:\/\/meet\.google\.com\/([a-z]{3}-[a-z]{4}-[a-z]{3})$/;

export async function sha256Hex(blob, cryptoImpl = globalThis.crypto) {
  if (!cryptoImpl?.subtle) throw new Error('Web Crypto không khả dụng');
  const digest = await cryptoImpl.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function roomFromUrl(meetingUrl) {
  const match = ROOM.exec(meetingUrl);
  if (!match) throw new Error('Bản ghi có URL Google Meet không hợp lệ');
  return match[1];
}

/** Coordinates authenticated metadata calls and the direct signed R2 PUT. */
export function createRecordingUploader({ store, apiFn, connectionFn, getUploadMinutes = async () => 0, signedPutFn = uploadToSignedUrl, digestFn = sha256Hex }) {
  const active = new Set();

  async function upload(input) {
    const record = typeof input === 'string' ? await store.get(input) : input;
    if (!record || record.status !== 'pending-upload' || !record.bytes || active.has(record.id) || record.uploadState === 'queued') return record;
    const connection = await connectionFn();
    if (!connection?.token) return record;
    const minimumMinutes = Math.max(0, Math.floor(Number(await getUploadMinutes()) || 0));
    const durationMinutes = Math.floor((Date.parse(record.endedAt) - Date.parse(record.startedAt)) / 60000);
    if (minimumMinutes > 0 && durationMinutes < minimumMinutes) {
      return await store.update(record.id, { uploadState: 'skipped-duration', uploadMinMinutes: minimumMinutes, uploadError: null });
    }
    active.add(record.id);
    try {
      await store.update(record.id, { uploadState: 'uploading', uploadError: null });
      const blob = await store.getBlob(record.id);
      const contentType = 'audio/webm';
      const created = await apiFn('POST', '/extension/v1/recordings', {
        action: 'create',
        clientSessionId: record.id,
        room: roomFromUrl(record.meetingUrl),
        meetUrl: record.meetingUrl,
        ...(record.eventId ? { eventId: record.eventId } : {}),
        startedAt: Date.parse(record.startedAt),
      });
      const attempt = await apiFn('POST', `/extension/v1/recordings/${encodeURIComponent(created.id)}/upload-attempts`, {
        action: 'issue',
        version: created.version,
        size: blob.size,
        contentType,
        digest: await digestFn(blob),
      });
      await signedPutFn(blob, { url: attempt.uploadUrl, headers: attempt.requiredHeaders });
      const finished = await apiFn('POST', `/extension/v1/recordings/${encodeURIComponent(created.id)}/finish`, {
        action: 'finish',
        attemptId: attempt.attemptId,
        version: attempt.version,
        endedAt: Date.parse(record.endedAt),
      });
      return await store.update(record.id, { uploadState: 'queued', remoteId: finished.id || created.id, remoteVersion: finished.version ?? attempt.version, uploadError: null });
    } catch (error) {
      return await store.update(record.id, { uploadState: 'error', uploadError: error.message || 'Không thể gửi bản ghi lên server.' });
    } finally {
      active.delete(record.id);
    }
  }

  async function uploadPending() {
    const records = await store.list();
    const results = [];
    for (const record of records) {
      if (record.status === 'pending-upload' && record.uploadState !== 'queued') results.push(await upload(record));
    }
    return results;
  }

  return { upload, uploadPending };
}

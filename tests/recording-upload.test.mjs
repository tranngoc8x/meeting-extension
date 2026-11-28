import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRecordingUploader } from '../recording-upload.js';

function fixture() {
  return {
    id: 'local-recording-1',
    status: 'pending-upload',
    uploadState: 'idle',
    meetingUrl: 'https://meet.google.com/abc-defg-hij',
    title: 'Daily meeting',
    startedAt: '2026-11-27T10:00:00.000Z',
    endedAt: '2026-11-27T10:02:00.000Z',
    mimeType: 'audio/webm;codecs=opus',
    bytes: 5,
  };
}

function memoryStore(record) {
  let current = structuredClone(record);
  const updates = [];
  return {
    updates,
    async get(id) { return id === current.id ? structuredClone(current) : undefined; },
    async list() { return [structuredClone(current)]; },
    async getBlob() { return new Blob(['audio'], { type: current.mimeType }); },
    async update(id, patch) { assert.equal(id, current.id); current = { ...current, ...patch }; updates.push(patch); return structuredClone(current); },
  };
}

test('uploads an authenticated recording through create, signed PUT, and finish', async () => {
  const record = fixture();
  const store = memoryStore(record);
  const calls = [];
  const signed = [];
  const apiFn = async (method, path, body) => {
    calls.push({ method, path, body });
    if (path === '/extension/v1/recordings') return { id: 'remote-1', version: 1 };
    if (path.endsWith('/upload-attempts')) return { attemptId: 'attempt-1', uploadUrl: 'https://r2.test/quarantine', requiredHeaders: { 'Content-Type': 'audio/webm', 'If-None-Match': '*' }, version: 2 };
    return { id: 'remote-1', state: 'queued', version: 3 };
  };
  const uploader = createRecordingUploader({ store, apiFn, connectionFn: async () => ({ token: 'token-1' }), digestFn: async blob => { assert.equal(blob.size, 5); return 'a'.repeat(64); }, signedPutFn: async (blob, signedUrl) => signed.push({ blob, signedUrl }) });

  const result = await uploader.upload(record);

  assert.equal(result.uploadState, 'queued');
  assert.deepEqual(calls, [
    { method: 'POST', path: '/extension/v1/recordings', body: { action: 'create', clientSessionId: record.id, room: 'abc-defg-hij', meetUrl: record.meetingUrl, startedAt: 1795773600000 } },
    { method: 'POST', path: '/extension/v1/recordings/remote-1/upload-attempts', body: { action: 'issue', version: 1, size: 5, contentType: 'audio/webm', digest: 'a'.repeat(64) } },
    { method: 'POST', path: '/extension/v1/recordings/remote-1/finish', body: { action: 'finish', attemptId: 'attempt-1', version: 2, endedAt: 1795773720000 } },
  ]);
  assert.equal(signed[0].signedUrl.url, 'https://r2.test/quarantine');
  assert.deepEqual(signed[0].signedUrl.headers, { 'Content-Type': 'audio/webm', 'If-None-Match': '*' });
  assert.deepEqual(store.updates.at(-1), { uploadState: 'queued', remoteId: 'remote-1', remoteVersion: 3, uploadError: null });
});

test('keeps a recording untouched when no authenticated token exists', async () => {
  const record = fixture();
  const store = memoryStore(record);
  let calls = 0;
  const uploader = createRecordingUploader({ store, apiFn: async () => { calls++; }, connectionFn: async () => ({ token: null }) });
  const result = await uploader.upload(record);
  assert.deepEqual(result, record);
  assert.equal(calls, 0);
  assert.deepEqual(store.updates, []);
});

test('reuses the local recording identity after a failed upload', async () => {
  const record = fixture();
  const store = memoryStore(record);
  const requests = [];
  const uploader = createRecordingUploader({
    store,
    connectionFn: async () => ({ token: 'token-1' }),
    digestFn: async () => 'b'.repeat(64),
    apiFn: async (method, path, body) => {
      requests.push({ method, path, body });
      if (path === '/extension/v1/recordings') throw new Error('offline');
    },
  });
  const result = await uploader.upload(record);
  assert.equal(result.uploadState, 'error');
  assert.equal(result.uploadError, 'offline');
  assert.equal(requests[0].body.clientSessionId, record.id);
});

test('skips short recordings without calling the API and uploads every recording at zero', async () => {
  const short = { ...fixture(), startedAt: '2026-11-27T10:00:00.000Z', endedAt: '2026-11-27T10:02:59.000Z' };
  const store = memoryStore(short);
  let calls = 0;
  const uploader = createRecordingUploader({ store, connectionFn: async () => ({ token: 'token-1' }), getUploadMinutes: async () => 3, apiFn: async () => { calls++; } });
  const skipped = await uploader.upload(short);
  assert.equal(skipped.uploadState, 'skipped-duration');
  assert.equal(calls, 0);

  const unlimitedStore = memoryStore({ ...short, id: 'local-recording-2' });
  const unlimited = createRecordingUploader({ unlimitedStore, store: unlimitedStore, connectionFn: async () => ({ token: 'token-1' }), getUploadMinutes: async () => 0, digestFn: async () => 'a'.repeat(64), apiFn: async (method, path) => path === '/extension/v1/recordings' ? { id: 'remote-2', version: 1 } : path.endsWith('/upload-attempts') ? { attemptId: 'attempt-2', uploadUrl: 'https://r2.test/q', requiredHeaders: {}, version: 2 } : { id: 'remote-2', version: 3 }, signedPutFn: async () => {} });
  assert.equal((await unlimited.upload({ ...short, id: 'local-recording-2' })).uploadState, 'queued');
});

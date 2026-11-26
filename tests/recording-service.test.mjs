import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRecordingService } from '../recording-service.js';

const room = 'https://meet.google.com/abc-defg-hij';
const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const sender = { id: 'extension', frameId: 0, documentId: 'document-1', tab: { id: 7 }, url: room };
function fixture() {
  const records = new Map(), chunks = [];
  let opened = 0;
  const store = {
    get: async id => records.get(id),
    begin: async record => { records.set(record.id, record); return record; },
    append: async (...args) => { chunks.push(args); },
    finish: async (id, patch) => { const r = { ...records.get(id), ...patch }; records.set(id, r); return r; },
    interruptTab: async () => {},
  };
  const handle = createRecordingService({ store, runtimeId: 'extension', openLibrary: async () => { opened++; } });
  return { handle, records, chunks, opened: () => opened };
}
const begin = { type: 'recording.begin', id, meetingUrl: room, title: 'Team sync', startedAt: '2026-11-26T12:00:00.000Z', mimeType: 'audio/webm;codecs=opus' };

test('only top-frame Meet content scripts can create recordings; room and document ownership are enforced', async () => {
  for (const untrusted of [{ ...sender, id: 'other' }, { ...sender, frameId: 2 }, { ...sender, url: 'https://evil.test/abc-defg-hij' }, { ...sender, documentId: undefined }]) {
    const f = fixture();
    await assert.rejects(f.handle(begin, untrusted));
    assert.equal(f.records.size, 0);
  }
  const f = fixture();
  await assert.rejects(f.handle({ ...begin, meetingUrl: 'https://meet.google.com/xxx-yyyy-zzz' }, sender));
  await f.handle(begin, sender);
  assert.equal(f.records.get(id).tabId, 7);
  assert.equal(f.records.get(id).documentId, 'document-1');
  await assert.rejects(f.handle({ type: 'recording.chunk', id, sequence: 0, data: 'YWJj' }, { ...sender, documentId: 'document-2' }));
  await assert.rejects(f.handle({ type: 'recording.finish', id }, { ...sender, tab: { id: 8 } }));
});

test('accepted chunks decode to bytes and finish queues local files without any speculative upload', async () => {
  const f = fixture();
  await f.handle(begin, sender);
  await f.handle({ type: 'recording.chunk', id, sequence: 0, data: 'YWJj' }, sender);
  assert.equal(await f.chunks[0][2].text(), 'abc');
  assert.deepEqual(f.chunks[0].slice(0, 2), [id, 0]);
  await f.handle({ type: 'recording.finish', id, endedAt: '2026-11-26T12:00:05.000Z' }, sender);
  assert.equal(f.records.get(id).status, 'pending-upload');
  assert.equal(f.records.get(id).endedAt, '2026-11-26T12:00:05.000Z');
});

test('malformed chunks and unbounded metadata never reach persistence', async () => {
  const f = fixture();
  await f.handle(begin, sender);
  for (const patch of [{ sequence: -1 }, { sequence: 0.5 }, { data: 'not-base64!' }, { data: '' }, { data: 'A'.repeat(3 * 1024 * 1024) }]) {
    await assert.rejects(f.handle({ type: 'recording.chunk', id, sequence: 0, data: 'YWJj', ...patch }, sender));
  }
  assert.equal(f.chunks.length, 0);
  await assert.rejects(f.handle({ ...begin, id: 'not-an-id' }, sender));
  await assert.rejects(f.handle({ ...begin, mimeType: 'video/webm' }, sender));
  await assert.rejects(f.handle({ ...begin, startedAt: 'invalid' }, sender));
});

test('library can be opened from Meet without exposing tokens or binary data in the reply', async () => {
  const f = fixture();
  assert.deepEqual(await f.handle({ type: 'recordings.open' }, sender), { ok: true });
  assert.equal(f.opened(), 1);
  await assert.rejects(f.handle({ type: 'recordings.open' }, { ...sender, id: 'other' }));
});

test('same-document navigation can flush and finalize the old room without stranding an active file', async () => {
  for (const url of ['https://meet.google.com/xxx-yyyy-zzz', 'https://meet.google.com/']) {
    const f = fixture();
    await f.handle(begin, sender);
    const moved = { ...sender, url };
    await f.handle({ type: 'recording.chunk', id, sequence: 0, data: 'YWJj' }, moved);
    await f.handle({ type: 'recording.finish', id, endedAt: '2026-11-26T12:00:05.000Z' }, moved);
    assert.equal(f.records.get(id).status, 'pending-upload');
    assert.equal(f.records.get(id).meetingUrl, room);
  }
});

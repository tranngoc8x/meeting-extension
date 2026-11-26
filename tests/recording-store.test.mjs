import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const source = await readFile(new URL('../recording-store.js', import.meta.url), 'utf8').catch(() => '/* recording store not implemented */');
let browser;
before(async () => { browser = await chromium.launch({ headless: true, channel: process.env.CHROME_CHANNEL || 'chrome' }); });
after(async () => { await browser?.close(); });
async function fixture(t) {
  const context = await browser.newContext();
  t.after(() => context.close());
  const page = await context.newPage();
  await page.route('http://recording.test/**', route => route.fulfill({ body: '<!doctype html><title>Recording store</title>', contentType: 'text/html' }));
  await page.goto('http://recording.test/');
  await page.addScriptTag({ content: source.replace(/export /g, '') });
  await page.evaluate(() => {
    globalThis.store = createRecordingStore();
    globalThis.record = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', tabId: 7, documentId: 'doc-one', meetingUrl: 'https://meet.google.com/abc-defg-hij', title: 'Daily meeting', startedAt: '2026-11-26T10:00:00.000Z', mimeType: 'audio/webm;codecs=opus' };
  });
  return page;
}

test('saved chunks survive store reopening and are assembled in order with final metadata', async t => {
  const page = await fixture(t);
  const result = await page.evaluate(async () => {
    await store.begin(record);
    await store.append(record.id, 0, new Blob(['first']));
    await store.append(record.id, 1, new Blob(['second']));
    await store.finish(record.id, { status: 'pending-upload', endedAt: '2026-11-26T10:02:00.000Z' });
    const reopened = createRecordingStore();
    const blob = await reopened.getBlob(record.id);
    return { text: await blob.text(), type: blob.type, metadata: await reopened.get(record.id), listed: await reopened.list() };
  });
  assert.equal(result.text, 'firstsecond');
  assert.equal(result.type, 'audio/webm;codecs=opus');
  assert.equal(result.metadata.bytes, 11);
  assert.equal(result.metadata.chunkCount, 2);
  assert.equal(result.metadata.status, 'pending-upload');
  assert.equal(result.metadata.title, 'Daily meeting');
  assert.equal(result.metadata.documentId, 'doc-one');
  assert.equal(result.metadata.endedAt, '2026-11-26T10:02:00.000Z');
  assert.deepEqual(result.listed, [result.metadata]);
});

test('chunk retries are idempotent; gaps, duplicate IDs and writes after finish are rejected', async t => {
  const page = await fixture(t);
  const result = await page.evaluate(async () => {
    const rejected = async operation => { try { await operation(); return false; } catch { return true; } };
    await store.begin(record);
    const duplicate = await rejected(() => store.begin(record));
    const gap = await rejected(() => store.append(record.id, 1, new Blob(['gap'])));
    await store.append(record.id, 0, new Blob(['one']));
    await store.append(record.id, 0, new Blob(['one']));
    const activeDelete = await rejected(() => store.remove(record.id));
    await store.finish(record.id, { status: 'pending-upload', endedAt: '2026-11-26T10:01:00Z' });
    const late = await rejected(() => store.append(record.id, 1, new Blob(['late'])));
    return { duplicate, gap, activeDelete, late, text: await (await store.getBlob(record.id)).text(), metadata: await store.get(record.id) };
  });
  assert.deepEqual([result.duplicate, result.gap, result.activeDelete, result.late], [true, true, true, true]);
  assert.equal(result.text, 'one');
  assert.equal(result.metadata.bytes, 3);
  assert.equal(result.metadata.chunkCount, 1);
});

test('tab interruption and startup recovery preserve bytes without relabeling completed recordings', async t => {
  const page = await fixture(t);
  const result = await page.evaluate(async () => {
    await store.begin(record);
    await store.append(record.id, 0, new Blob(['partial']));
    await store.begin({ ...record, id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', tabId: 8 });
    await store.begin({ ...record, id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', tabId: 7 });
    await store.finish('cccccccc-cccc-4ccc-8ccc-cccccccccccc', { status: 'pending-upload', endedAt: '2026-11-26T10:01:00Z' });
    await store.interruptTab(7);
    const before = (await store.list()).map(({ id, status }) => ({ id, status }));
    await store.recover();
    return { before, after: (await store.list()).map(({ id, status }) => ({ id, status })), text: await (await store.getBlob(record.id)).text() };
  });
  const byId = entries => Object.fromEntries(entries.map(({ id, status }) => [id[0], status]));
  assert.deepEqual(byId(result.before), { a: 'interrupted', b: 'recording', c: 'pending-upload' });
  assert.deepEqual(byId(result.after), { a: 'interrupted', b: 'interrupted', c: 'pending-upload' });
  assert.equal(result.text, 'partial');
});

test('deleting a finished recording removes its chunks and metadata', async t => {
  const page = await fixture(t);
  const result = await page.evaluate(async () => {
    await store.begin(record);
    await store.append(record.id, 0, new Blob(['secret audio']));
    await store.finish(record.id, { status: 'pending-upload', endedAt: '2026-11-26T10:01:00Z' });
    await store.remove(record.id);
    let missing = false;
    try { await store.getBlob(record.id); } catch { missing = true; }
    return { listed: await store.list(), record: await store.get(record.id), missing };
  });
  assert.deepEqual(result, { listed: [], record: undefined, missing: true });
});

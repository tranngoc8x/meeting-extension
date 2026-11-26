import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
const root = new URL('../', import.meta.url);
async function fixture(t) {
  const browser = await chromium.launch({ headless: true, channel: process.env.CHROME_CHANNEL || 'chrome' });
  t.after(() => browser.close());
  const page = await browser.newPage({ acceptDownloads: true });
  await page.route('https://extension.test/**', async route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/empty') return route.fulfill({ contentType: 'text/html', body: '<title>Fixture</title>' });
    try {
      const body = await readFile(new URL(pathname.slice(1), root));
      await route.fulfill({ contentType: pathname.endsWith('.js') ? 'application/javascript' : pathname.endsWith('.css') ? 'text/css' : 'text/html', body });
    } catch { await route.fulfill({ status: 404, body: 'Not implemented' }); }
  });
  await page.goto('https://extension.test/empty');
  await page.evaluate(async () => {
    const { createRecordingStore } = await import('/recording-store.js');
    const store = createRecordingStore();
    await store.begin({ id: 'file', title: '<img src=x onerror=alert(1)> / Team sync', startedAt: '2026-11-26T12:00:00.000Z', mimeType: 'audio/webm', tabId: 1 });
    await store.append('file', 0, new Blob(['audio-bytes']));
    await store.finish('file', { status: 'pending-upload', endedAt: '2026-11-26T12:00:05.000Z' });
    await store.begin({ id: 'active', title: 'In progress', startedAt: '2026-11-26T13:00:00.000Z', mimeType: 'audio/webm', tabId: 2 });
  });
  await page.goto('https://extension.test/recordings.html');
  return page;
}

test('local library downloads persisted bytes safely and does not allow deleting active captures', async t => {
  const p = await fixture(t);
  await p.getByRole('heading', { name: 'Bản ghi trên máy' }).waitFor();
  const file = p.locator('article').filter({ hasText: 'Team sync' });
  await file.waitFor();
  assert.equal(await file.locator('img').count(), 0);
  assert.equal(await file.getByText('Chờ kết nối upload', { exact: true }).count(), 1);
  const active = p.locator('article').filter({ hasText: 'In progress' });
  assert.equal(await active.getByRole('button', { name: 'Xóa' }).isDisabled(), true);
  assert.equal(await active.getByRole('button', { name: 'Tải về' }).isDisabled(), true);
  const downloadEvent = p.waitForEvent('download');
  await file.getByRole('button', { name: 'Tải về' }).click();
  const download = await downloadEvent;
  assert.match(download.suggestedFilename(), /Team sync.*\.webm$/);
  assert.doesNotMatch(download.suggestedFilename(), /[<>:/\\]/);
  assert.equal((await readFile(await download.path())).toString(), 'audio-bytes');
  p.once('dialog', dialog => dialog.accept());
  await file.getByRole('button', { name: 'Xóa', exact: true }).click();
  await file.waitFor({ state: 'detached' });
  await p.reload();
  await active.waitFor();
  assert.equal(await p.locator('article').count(), 1);
});

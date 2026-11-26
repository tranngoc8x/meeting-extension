import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
const root = new URL('../', import.meta.url);

test('native tab capture persists encoded audio through background routing and downloads from local library', async t => {
  const browser = await chromium.launch({ headless: true, channel: process.env.CHROME_CHANNEL || 'chrome', args: [
    '--auto-select-tab-capture-source-by-title=Team integration - Google Meet',
    '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
  ] });
  t.after(() => browser.close());
  const page = await browser.newPage({ acceptDownloads: true });
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://meet.google.com/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/abc-defg-hij') return route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><meta charset="utf-8"><title>Team integration - Google Meet</title><main><button aria-label="Leave call">Leave</button></main>' });
    const file = path.slice(1);
    const body = await readFile(new URL(file, root));
    await route.fulfill({ contentType: `${file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html'}; charset=utf-8`, body });
  });
  await page.goto('https://meet.google.com/abc-defg-hij');
  await page.evaluate(async () => {
    const listeners = [], values = {};
    const event = () => ({ addListener() {}, removeListener() {} });
    const local = {
      async get(key) { return key === null ? values : { [key]: values[key] }; },
      async set(data) { Object.assign(values, data); }, async remove(keys) { for (const key of keys) delete values[key]; },
      async setAccessLevel() {},
    };
    window.chrome = {
      storage: { local },
      tabs: { onRemoved: event(), onUpdated: event(), async create() {} },
      runtime: {
        id: 'integration', getURL: path => `https://meet.google.com/${path}`, onInstalled: event(), onStartup: event(),
        onMessage: { addListener(listener) { listeners.push(listener); }, removeListener(listener) { const index = listeners.indexOf(listener); if (index >= 0) listeners.splice(index, 1); } },
        sendMessage(message) {
          return new Promise((resolve, reject) => {
            const sender = { id: 'integration', frameId: 0, documentId: 'integration-document', tab: { id: 7 }, url: 'https://meet.google.com/abc-defg-hij' };
            let handled = false;
            for (const listener of [...listeners]) if (listener(message, sender, resolve) === true) handled = true;
            if (!handled) reject(Error(`No handler for ${message.type}`));
          });
        },
      },
    };
    await import('/background.js');
    window.fixtureAudio = new AudioContext();
    window.tone = fixtureAudio.createOscillator(); tone.frequency.value = 350; tone.connect(fixtureAudio.destination); tone.start();
    document.addEventListener('pointerdown', () => fixtureAudio.resume(), { once: true });
  });
  for (const file of ['detector.js', 'recorder.js', 'recording-ui.js', 'content.js']) await page.addScriptTag({ url: `https://meet.google.com/${file}` });
  assert.deepEqual(errors, [], 'content scripts must initialize without exceptions');
  assert.equal(await page.locator('#july-recording-panel').count(), 1);
  await page.getByRole('button', { name: 'Ghi âm cuộc họp', exact: true }).click();
  await page.getByRole('button', { name: 'Dừng ghi âm', exact: true }).waitFor();
  await page.waitForTimeout(1300);
  await page.getByRole('button', { name: 'Dừng ghi âm', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Đã lưu trên máy' }).waitFor();
  const result = await page.evaluate(async () => {
    const { createRecordingStore } = await import('/recording-store.js');
    const store = createRecordingStore();
    const [record] = await store.list();
    const blob = await store.getBlob(record.id);
    const audio = await fixtureAudio.decodeAudioData(await blob.arrayBuffer());
    tone.stop(); await fixtureAudio.close();
    return { record, size: blob.size, peak: Math.max(...audio.getChannelData(0).subarray(0, 32768).map(Math.abs)) };
  });
  assert.equal(result.record.title, 'Team integration');
  assert.equal(result.record.status, 'pending-upload');
  assert.ok(result.size > 1000);
  assert.ok(result.peak > 0.01);
  await page.screenshot({ path: '/tmp/meeting-recording-panel.png' });
  await page.goto('https://meet.google.com/recordings.html');
  const file = page.locator('article').filter({ hasText: 'Team integration' });
  await file.waitFor();
  const downloadEvent = page.waitForEvent('download');
  await file.getByRole('button', { name: 'Tải về' }).click();
  const download = await downloadEvent;
  assert.equal((await readFile(await download.path())).byteLength, result.size);
  await page.screenshot({ path: '/tmp/meeting-recordings-library.png' });
});

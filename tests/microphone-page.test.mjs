import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
const root = new URL('../', import.meta.url);
test('visible microphone setup acquires permission only on click and immediately releases its stream', async t => {
  const browser = await chromium.launch({ channel: process.env.CHROME_CHANNEL || 'chrome', headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  page.setDefaultTimeout(5000);
  await page.route('https://extension.test/**', async route => {
    const file = new URL(route.request().url()).pathname.slice(1);
    const body = await readFile(new URL(file, root)).catch(() => Buffer.from('Not implemented'));
    await route.fulfill({ contentType: `${file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html'}; charset=utf-8`, body });
  });
  await page.addInitScript(() => {
    window.acquisitions = 0; window.stops = 0;
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async constraints => {
      if (!constraints.audio || constraints.video !== false) throw Error('Microphone only');
      acquisitions++;
      return { getTracks: () => [{ stop() { stops++; } }] };
    } } });
  });
  await page.goto('https://extension.test/microphone.html');
  assert.equal(await page.evaluate(() => acquisitions), 0);
  await page.getByRole('button', { name: 'Cho phép micro' }).click();
  await page.getByRole('status').filter({ hasText: 'Đã cấp quyền micro' }).waitFor();
  assert.deepEqual(await page.evaluate(() => [acquisitions, stops]), [1, 1]);
});

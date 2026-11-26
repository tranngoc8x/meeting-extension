import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
const root = new URL('../', import.meta.url);
async function fixture(t, denied = false) {
  const browser = await chromium.launch({ channel: process.env.CHROME_CHANNEL || 'chrome', headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  page.setDefaultTimeout(5000);
  await page.route('https://extension.test/**', async route => {
    const file = new URL(route.request().url()).pathname.slice(1);
    await route.fulfill({ contentType: `${file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html'}; charset=utf-8`, body: await readFile(new URL(file, root)) });
  });
  await page.addInitScript(denied => {
    window.acquisitions = 0; window.stops = 0; window.closedByScript = 0; window.messages = [];
    window.close = () => { closedByScript++; };
    window.chrome = { runtime: { sendMessage: message => {
      messages.push(message);
      return new Promise(resolve => { window.resumeCapture = result => resolve(result); });
    } } };
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async constraints => {
      if (!constraints.audio || constraints.video !== false) throw Error('Microphone only');
      acquisitions++;
      if (denied) throw new DOMException('Denied', 'NotAllowedError');
      return { getTracks: () => [{ stop() { stops++; } }] };
    } } });
  }, denied);
  await page.goto('https://extension.test/microphone.html');
  return page;
}

test('microphone helper requests automatically and holds its stream until offscreen resumes, then closes', async t => {
  const page = await fixture(t);
  await page.waitForFunction(() => messages.length === 1);
  assert.deepEqual(await page.evaluate(() => ({ acquisitions, stops, closedByScript, messages })), {
    acquisitions: 1, stops: 0, closedByScript: 0, messages: [{ type: 'recording.microphone-ready' }],
  });
  await page.evaluate(() => resumeCapture({ ok: true, resumed: true, state: { status: 'recording' } }));
  await page.waitForFunction(() => closedByScript === 1);
  assert.equal(await page.evaluate(() => stops), 1);
});

test('permission denial does not loop or close the helper and offers an explicit retry', async t => {
  const page = await fixture(t, true);
  await page.getByRole('button', { name: 'Thử lại' }).waitFor();
  assert.deepEqual(await page.evaluate(() => [acquisitions, stops, closedByScript, messages.length]), [1, 0, 0, 0]);
  await page.getByRole('button', { name: 'Thử lại' }).click();
  assert.equal(await page.evaluate(() => acquisitions), 2);
});

test('failed recording handoff releases the temporary microphone and keeps a visible error', async t => {
  const page = await fixture(t);
  await page.waitForFunction(() => messages.length === 1);
  await page.evaluate(() => resumeCapture({ ok: false, error: 'Cuộc họp đã đóng' }));
  await page.getByRole('button', { name: 'Thử lại' }).waitFor();
  assert.equal(await page.getByRole('alert').textContent(), 'Cuộc họp đã đóng');
  assert.deepEqual(await page.evaluate(() => [stops, closedByScript]), [1, 0]);
});

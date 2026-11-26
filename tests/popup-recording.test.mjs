import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
const root = new URL('../', import.meta.url);
test('popup keeps Stop available when capture is active with an error', async t => {
  const browser = await chromium.launch({ channel: process.env.CHROME_CHANNEL || 'chrome', headless: true });
  t.after(() => browser.close());
  const p = await browser.newPage(); p.setDefaultTimeout(3000);
  await p.route('https://extension.test/**', async route => {
    const file = new URL(route.request().url()).pathname.slice(1);
    await route.fulfill({ contentType: `${file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html'}; charset=utf-8`, body: await readFile(new URL(file, root)) });
  });
  await p.addInitScript(() => {
    window.requests = [];
    const area = { get: async () => ({}), set: async () => {} };
    window.chrome = {
      storage: { local: area, sync: area },
      tabs: { query: async () => [{ id: 1 }], sendMessage: async () => ({ detected: true, inCall: true, meetingUrl: 'https://meet.google.com/abc-defg-hij' }), onActivated: { addListener() {} } },
      runtime: { id: 'extension', getURL: path => `https://extension.test/${path}`, onMessage: { addListener() {} }, sendMessage: async message => {
        requests.push(message.type);
        return message.type === 'recording.stop' ? { ok: true, state: { status: 'saved' }, active: false }
          : { ok: true, state: { status: 'error', error: 'Stop failed' }, active: true };
      } },
    };
  });
  await p.goto('https://extension.test/popup.html');
  await p.getByRole('button', { name: 'Dừng ghi âm', exact: true }).click();
  assert.equal(await p.evaluate(() => requests.at(-1)), 'recording.stop');
  assert.equal(await p.evaluate(() => requests.includes('recording.start')), false);
});

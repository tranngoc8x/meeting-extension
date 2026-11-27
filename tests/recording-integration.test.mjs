import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';

// Actual extension/action/offscreen; fresh profile, synthetic tab + fake mic.
// No global permission pregrant: exercise the first-use handoff itself.
test('native toolbar click records directly and floating controls restart with a small one-time mic window', { skip: !process.env.CAPTURE_BROWSER_EXECUTABLE }, async t => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url)));
  const extensionId = createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest('hex').slice(0, 32).replace(/[0-9a-f]/g, c => String.fromCharCode(97 + parseInt(c, 16)));
  const profile = await mkdtemp(join(tmpdir(), 'july-tab-capture-'));
  const context = await chromium.launchPersistentContext(profile, {
    executablePath: process.env.CAPTURE_BROWSER_EXECUTABLE, headless: false,
    ignoreDefaultArgs: ['--disable-extensions'],
    args: ['--headless=new', `--disable-extensions-except=${root}`, `--load-extension=${root}`, '--enable-unsafe-extension-debugging', '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', '--use-fake-device-for-media-stream', '--auto-accept-camera-and-microphone-capture'],
    acceptDownloads: true,
  });
  t.after(async () => { await context.close(); await rm(profile, { recursive: true, force: true }); });
  const workerURL = `chrome-extension://${extensionId}/background.js`;
  const worker = context.serviceWorkers().find(w => w.url() === workerURL) || await context.waitForEvent('serviceworker', { predicate: w => w.url() === workerURL, timeout: 10000 });
  await worker.evaluate(async () => {
    const deadline = Date.now() + 5000;
    while (typeof chrome === 'undefined' || !chrome.runtime.onMessage.hasListeners()) {
      if (Date.now() > deadline) throw Error('Extension did not initialize; use current Chrome for Testing.');
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  });
  await context.route('https://meet.google.com/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><meta charset="utf-8"><title>Tab audio integration - Google Meet</title><main><button aria-label="Leave call">Leave</button></main>' }));
  const meeting = await context.newPage();
  meeting.setDefaultTimeout(15000);
  const errors = [];
  meeting.on('pageerror', error => errors.push(error.message));
  await meeting.goto('https://meet.google.com/abc-defg-hij');
  await meeting.locator('#july-recording-panel').waitFor();
  await meeting.evaluate(() => document.addEventListener('pointerdown', () => {
    const audio = new AudioContext(), tone = audio.createOscillator();
    tone.frequency.value = 350; tone.connect(audio.destination); tone.start();
  }, { once: true }));
  await meeting.locator('main').click();
  const port = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0];
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const protocol = await browser.newBrowserCDPSession();
  const downloads = join(profile, 'downloads');
  await mkdir(downloads);
  await protocol.send('Browser.setDownloadBehavior', { behavior: 'allowAndName', downloadPath: downloads, eventsEnabled: true });
  await meeting.bringToFront();
  await worker.evaluate(() => {
    globalThis.createdMicWindows = [];
    chrome.windows.onCreated.addListener(window => createdMicWindows.push({ type: window.type, width: window.width, height: window.height }));
  });
  async function clickIcon() {
    await meeting.bringToFront();
    const { targetInfos } = await protocol.send('Target.getTargets', { filter: [{ type: 'tab' }] });
    const target = targetInfos.find(info => info.url === meeting.url());
    assert.ok(target);
    await protocol.send('Extensions.triggerAction', { id: extensionId, targetId: target.targetId });
  }
  let openedPages = 0;
  context.on('page', () => { openedPages++; });
  await meeting.getByRole('button', { name: 'Ghi âm', exact: true }).click();
  await meeting.getByRole('alert').filter({ hasText: /icon July/ }).waitFor();
  assert.equal(openedPages, 0, 'uninvoked float cannot open mic setup or capture silently');
  assert.equal((await worker.evaluate(() => chrome.tabCapture.getCapturedTabs())).some(tab => tab.status === 'active'), false);
  const setupOpened = context.waitForEvent('page', { timeout: 10000 });
  await clickIcon();
  const setup = await setupOpened;
  if (!setup.isClosed()) await setup.waitForEvent('close', { timeout: 15000 });
  assert.match(setup.url(), /\/microphone\.html$/);
  const windows = await worker.evaluate(() => createdMicWindows);
  assert.ok(windows.some(window => window.type === 'popup' && window.width <= 600 && window.height <= 600), 'microphone setup must use a bounded popup window');
  await meeting.getByRole('button', { name: 'Dừng ghi âm', exact: true }).waitFor();
  await meeting.waitForTimeout(1500);
  assert.equal((await worker.evaluate(() => chrome.tabCapture.getCapturedTabs())).filter(tab => tab.status === 'active').length, 1);
  assert.equal(setup.isClosed(), true, 'capture must not require the setup page to remain open');
  await meeting.getByRole('button', { name: 'Dừng ghi âm', exact: true }).click();
  await meeting.getByRole('status').filter({ hasText: 'Đã lưu trên máy' }).waitFor();
  assert.equal(openedPages, 1, 'first use opens only the one-time mic popup window');
  await meeting.getByRole('button', { name: 'Ghi âm', exact: true }).click();
  await meeting.getByRole('button', { name: 'Dừng ghi âm', exact: true }).waitFor();
  assert.equal(openedPages, 1, 'floating Start reuses the tab grant without another icon or window');
  await meeting.waitForTimeout(1200);
  await clickIcon();
  await meeting.getByRole('status').filter({ hasText: 'Đã lưu trên máy' }).waitFor();
  assert.equal((await worker.evaluate(() => chrome.tabCapture.getCapturedTabs())).some(tab => tab.status === 'active'), false);
  await clickIcon();
  await meeting.getByRole('button', { name: 'Dừng ghi âm', exact: true }).waitFor();
  assert.equal(openedPages, 1, 'subsequent toolbar Start records immediately without a popup or permission window');
  await meeting.waitForTimeout(1200);
  await meeting.getByRole('button', { name: 'Dừng ghi âm', exact: true }).click();
  await meeting.getByRole('status').filter({ hasText: 'Đã lưu trên máy' }).waitFor();
  assert.equal((await worker.evaluate(() => chrome.tabCapture.getCapturedTabs())).some(tab => tab.status === 'active'), false);
  await meeting.screenshot({ path: '/tmp/meeting-float-start-panel.png' });
  const library = await context.newPage();
  await library.goto(`chrome-extension://${extensionId}/recordings.html`);
  const files = library.locator('article').filter({ hasText: 'Tab audio integration' });
  await files.first().waitFor();
  assert.equal(await files.count(), 3);
  const downloading = library.waitForEvent('download');
  await files.first().getByRole('button', { name: 'Tải về' }).click();
  const download = await downloading;
  const bytes = await readFile(join(downloads, basename(await download.path())));
  assert.ok(bytes.length > 1000);
  const audio = await library.evaluate(async data => {
    const decoder = new AudioContext(), decoded = await decoder.decodeAudioData(Uint8Array.from(data).buffer);
    const peak = Math.max(...decoded.getChannelData(0).subarray(0, 32768).map(Math.abs));
    await decoder.close(); return { peak, duration: decoded.duration };
  }, [...bytes]);
  assert.ok(audio.peak > 0.01); assert.ok(audio.duration > 1);
  assert.deepEqual(errors, []);
});

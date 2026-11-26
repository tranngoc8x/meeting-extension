import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';

// Stock Chrome blocks CLI sideloading. Supply a test Chromium without touching
// the user's browser profile. All media in this test is synthetic.
test('native extension invocation records tab audio in offscreen and downloads a decodable local WebM', { skip: !process.env.CAPTURE_BROWSER_EXECUTABLE }, async t => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url)));
  const extensionId = createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest('hex').slice(0, 32).replace(/[0-9a-f]/g, character => String.fromCharCode(97 + parseInt(character, 16)));
  const expectedWorker = `chrome-extension://${extensionId}/background.js`;
  const profile = await mkdtemp(join(tmpdir(), 'july-tab-capture-'));
  const context = await chromium.launchPersistentContext(profile, {
    executablePath: process.env.CAPTURE_BROWSER_EXECUTABLE, headless: false,
    ignoreDefaultArgs: ['--disable-extensions'],
    args: [...(process.env.CAPTURE_NATIVE_UI ? [] : ['--headless=new']), `--disable-extensions-except=${root}`, `--load-extension=${root}`, '--enable-unsafe-extension-debugging', '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', '--use-fake-device-for-media-stream', '--auto-accept-camera-and-microphone-capture'],
    acceptDownloads: true,
  });
  t.after(async () => { await context.close(); await rm(profile, { recursive: true, force: true }); });
  const worker = context.serviceWorkers().find(item => item.url() === expectedWorker) || await context.waitForEvent('serviceworker', { predicate: item => item.url() === expectedWorker, timeout: 10000 });
  await worker.evaluate(async () => {
    const initialized = Date.now() + 5000;
    while (typeof chrome === 'undefined') {
      if (Date.now() > initialized) throw Error('Extension API bindings did not initialize');
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    if (typeof chrome.storage.local.setAccessLevel !== 'function') throw Error('Native test browser lacks the token-protection API; use current Chrome for Testing.');
    const deadline = Date.now() + 5000;
    while (!chrome.runtime.onMessage.hasListeners()) {
      if (Date.now() > deadline) throw Error('Extension worker did not initialize its message handlers');
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  });
  const origin = `chrome-extension://${new URL(worker.url()).host}`;
  // Auto-accepting fake-device UI does not persist the permission query state.
  // Explicitly grant it only in this disposable profile; devices remain synthetic.
  await context.grantPermissions(['microphone']);
  const errors = [];
  await context.route('https://meet.google.com/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><meta charset="utf-8"><title>Tab audio integration - Google Meet</title><main><button aria-label="Leave call">Leave</button></main>' }));
  const permission = await context.newPage();
  await permission.goto(`${origin}/microphone.html`);
  await permission.getByRole('button', { name: 'Cho phép micro' }).click();
  await permission.getByRole('status').filter({ hasText: 'Đã cấp quyền micro' }).waitFor();
  await permission.close();
  const meeting = await context.newPage();
  meeting.setDefaultTimeout(10000);
  meeting.on('pageerror', error => errors.push(error.message));
  await meeting.goto('https://meet.google.com/abc-defg-hij');
  await meeting.getByRole('button', { name: 'Cách bắt đầu ghi âm', exact: true }).waitFor();
  await meeting.evaluate(() => {
    document.addEventListener('pointerdown', () => {
      window.audio = new AudioContext(); window.tone = audio.createOscillator();
      tone.frequency.value = 350; tone.connect(audio.destination); tone.start();
    }, { once: true });
  });
  await meeting.locator('main').click();
  let nativeDownloadDirectory;
  if (process.env.CAPTURE_NATIVE_UI) {
    console.log('Waiting for native recording invocation in isolated test Chrome');
    meeting.setDefaultTimeout(180000);
  } else {
    const helper = await context.newPage();
    await helper.goto(`${origin}/recordings.html`);
    await meeting.bringToFront();
    const port = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0];
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    const browserProtocol = await browser.newBrowserCDPSession();
    // Both CDP clients observe downloads. Use one explicit directory rather than
    // either client's private artifact path.
    nativeDownloadDirectory = join(profile, 'downloads');
    await mkdir(nativeDownloadDirectory);
    await browserProtocol.send('Browser.setDownloadBehavior', { behavior: 'allowAndName', downloadPath: nativeDownloadDirectory, eventsEnabled: true });
    const { targetInfos } = await browserProtocol.send('Target.getTargets', { filter: [{ type: 'tab' }] });
    const targetInfo = targetInfos.find(target => target.url === meeting.url());
    assert.ok(targetInfo, `Meet tab target must exist: ${JSON.stringify(targetInfos)}`);
    // This invokes Chrome's actual extension action, including activeTab grant.
    // action.openPopup alone does not grant access to the active tab.
    await browserProtocol.send('Extensions.triggerAction', { id: extensionId, targetId: targetInfo.targetId });
    let ready = false;
    for (let attempt = 0; attempt < 50 && !ready; attempt++) {
      ready = await helper.evaluate(() => {
        const popup = chrome.extension.getViews({ type: 'popup' })[0];
        return Boolean(popup?.document.querySelector('#recording-toggle') && !popup.document.querySelector('#recording-toggle').disabled);
      });
      if (!ready) await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(ready, true, 'native action popup must become ready');
    await helper.evaluate(() => chrome.extension.getViews({ type: 'popup' })[0].document.querySelector('#recording-toggle').click());
  }
  await meeting.getByRole('button', { name: 'Dừng ghi âm', exact: true }).waitFor().catch(async error => {
    const diagnostics = await worker.evaluate(async () => ({ status: await chrome.storage.session.get('recording-controller'), tabs: await chrome.tabs.query({active:true,currentWindow:true}), commands: await chrome.commands.getAll(), contexts: await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] }) }));
    throw new Error(`${error.message}\n${JSON.stringify(diagnostics)}`);
  });
  await meeting.waitForTimeout(1500);
  const capture = await worker.evaluate(async () => (await chrome.runtime.sendMessage({ target: 'offscreen', type: 'recording.offscreen.status' })));
  assert.equal(capture.state.status, 'recording');
  const tabs = await worker.evaluate(() => chrome.tabCapture.getCapturedTabs());
  assert.equal(tabs.filter(tab => tab.status === 'active').length, 1);
  await meeting.getByRole('button', { name: 'Dừng ghi âm', exact: true }).click();
  await meeting.getByRole('status').filter({ hasText: 'Đã lưu trên máy' }).waitFor();
  assert.equal((await worker.evaluate(() => chrome.tabCapture.getCapturedTabs())).some(tab => tab.status === 'active'), false);
  await meeting.screenshot({ path: '/tmp/meeting-tabcapture-panel.png' });
  const library = await context.newPage();
  await library.goto(`${origin}/recordings.html`);
  const file = library.locator('article').filter({ hasText: 'Tab audio integration' });
  await file.waitFor();
  const downloading = library.waitForEvent('download');
  await file.getByRole('button', { name: 'Tải về' }).click();
  const download = await downloading;
  const artifact = await download.path();
  const bytes = await readFile(nativeDownloadDirectory ? join(nativeDownloadDirectory, basename(artifact)) : artifact);
  assert.ok(bytes.length > 1000);
  const audio = await library.evaluate(async data => {
    const decoder = new AudioContext();
    const decoded = await decoder.decodeAudioData(Uint8Array.from(data).buffer);
    const peak = Math.max(...decoded.getChannelData(0).subarray(0, 32768).map(Math.abs));
    await decoder.close();
    return { peak, duration: decoded.duration };
  }, [...bytes]);
  assert.ok(audio.peak > 0.01);
  assert.ok(audio.duration > 1);
  assert.deepEqual(errors, []);
});

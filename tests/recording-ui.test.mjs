import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
const source = await readFile(new URL('../recording-ui.js', import.meta.url), 'utf8').catch(() => '/* recording UI not implemented */');

async function fixture(t) {
  const browser = await chromium.launch({ headless: true, channel: process.env.CHROME_CHANNEL || 'chrome' });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setContent('<title>Team sync - Google Meet</title><main></main>');
  await page.evaluate(() => {
    window.messages = []; window.starts = []; window.stops = 0;
    window.chrome = { runtime: { sendMessage: async message => { messages.push(message); return { ok: true }; } } };
    window.MeetingRecorder = { create(options) {
      window.recorderOptions = options;
      return {
        start: async metadata => { starts.push(metadata); options.onState({ status: 'recording', startedAt: new Date().toISOString() }); },
        stop: async () => { stops++; options.onState({ status: 'saved' }); },
        getState: () => ({ status: 'recording' }),
      };
    } };
  });
  await page.addScriptTag({ content: source });
  await page.evaluate(() => { window.panel = MeetingRecordingUI.create(); });
  return page;
}

test('visible in-Meet controls start/stop with room metadata and open local files', async t => {
  const p = await fixture(t);
  const record = p.getByRole('button', { name: 'Ghi âm cuộc họp', exact: true });
  assert.equal(await record.isDisabled(), true);
  await p.evaluate(() => panel.updateMeeting({ inCall: true, meetingUrl: 'https://meet.google.com/abc-defg-hij' }));
  await record.click();
  assert.deepEqual(await p.evaluate(() => starts), [{ meetingUrl: 'https://meet.google.com/abc-defg-hij', title: 'Team sync' }]);
  await p.getByRole('button', { name: 'Dừng ghi âm' }).click();
  assert.equal(await p.evaluate(() => stops), 1);
  assert.equal(await p.getByRole('status').textContent(), 'Đã lưu trên máy · Chờ kết nối upload');
  await p.getByRole('button', { name: 'Bản ghi trên máy' }).click();
  assert.deepEqual(await p.evaluate(() => messages), [{ type: 'recordings.open' }]);
});

test('recording errors are visible and compact mode retains a working primary control', async t => {
  const p = await fixture(t);
  await p.evaluate(() => panel.updateMeeting({ inCall: true, meetingUrl: 'https://meet.google.com/abc-defg-hij' }));
  await p.getByRole('button', { name: 'Thu gọn' }).click();
  assert.equal(await p.getByRole('button', { name: 'Ghi âm cuộc họp', exact: true }).isVisible(), true);
  await p.evaluate(() => recorderOptions.onState({ status: 'error', error: 'Cần chia sẻ âm thanh của tab' }));
  assert.equal(await p.getByRole('alert').textContent(), 'Cần chia sẻ âm thanh của tab');
  assert.equal(await p.getByRole('button', { name: 'Ghi âm cuộc họp', exact: true }).isEnabled(), true);
});

test('panel typography is isolated from the host page defaults', async t => {
  const p = await fixture(t);
  const font = await p.locator('#july-recording-panel').evaluate(host => getComputedStyle(host.shadowRoot.querySelector('.panel')).fontFamily);
  assert.match(font, /system-ui/);
});

test('auto-stop ignores hidden call controls and stops only after sustained absence', async t => {
  const p = await fixture(t);
  await p.evaluate(() => {
    window.fakeNow = Date.now(); Date.now = () => fakeNow;
    document.querySelector('main').innerHTML = '<button aria-label="Leave call" hidden>End</button>';
    panel.updateMeeting({ inCall: true, meetingUrl: 'https://meet.google.com/abc-defg-hij' });
    recorderOptions.onState({ status: 'recording', startedAt: new Date().toISOString() });
    panel.updateMeeting({ inCall: false, meetingUrl: 'https://meet.google.com/abc-defg-hij' });
    fakeNow += 10000;
  });
  await p.waitForTimeout(1100);
  assert.equal(await p.evaluate(() => stops), 0);
  await p.evaluate(() => document.querySelector('main').replaceChildren());
  await p.waitForTimeout(1100);
  await p.evaluate(() => { fakeNow += 7000; });
  await p.waitForTimeout(1100);
  assert.equal(await p.evaluate(() => stops), 1);
});

test('changing Meet rooms ends the previous room recording', async t => {
  const p = await fixture(t);
  await p.evaluate(() => {
    window.MeetDetector = { normalizeUrl: () => window.currentRoom };
    window.currentRoom = 'https://meet.google.com/abc-defg-hij';
    panel.updateMeeting({ inCall: true, meetingUrl: currentRoom });
  });
  await p.getByRole('button', { name: 'Ghi âm cuộc họp', exact: true }).click();
  await p.evaluate(() => {
    currentRoom = 'https://meet.google.com/xxx-yyyy-zzz';
    panel.updateMeeting({ inCall: true, meetingUrl: currentRoom });
  });
  await p.waitForTimeout(1100);
  assert.equal(await p.evaluate(() => stops), 1);
});

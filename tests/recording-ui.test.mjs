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
    window.messages = []; window.stops = 0; window.stateListeners = [];
    window.chrome = { runtime: {
      id: 'extension',
      onMessage: { addListener: listener => stateListeners.push(listener), removeListener: listener => { stateListeners = stateListeners.filter(item => item !== listener); } },
      sendMessage: async message => {
        messages.push(message);
        if (message.type === 'recording.start') return { ok: true, state: { status: 'recording', startedAt: new Date().toISOString() }, active: true, meetingUrl: 'https://meet.google.com/abc-defg-hij' };
        if (message.type === 'recording.stop') { stops++; return { ok: true, state: { status: 'saved' } }; }
        return { ok: true, state: { status: 'idle' }, shortcut: 'Alt+Shift+R' };
      },
    } };
    window.emitState = (state, active = false) => stateListeners.forEach(listener => listener({ type: 'recording.state', state, active, meetingUrl: 'https://meet.google.com/abc-defg-hij' }, { id: 'extension' }));
  });
  await page.addScriptTag({ content: source });
  await page.evaluate(() => { window.panel = MeetingRecordingUI.create(); });
  return page;
}

test('Meet card starts and stops recording with a trusted click and ignores synthetic page clicks', async t => {
  const p = await fixture(t);
  assert.equal(await p.getByRole('button', { name: 'Cách bắt đầu ghi âm', exact: true }).count(), 0);
  assert.equal(await p.getByRole('button', { name: 'Ghi âm', exact: true }).isDisabled(), true);
  await p.evaluate(() => panel.updateMeeting({ inCall: true, meetingUrl: 'https://meet.google.com/abc-defg-hij' }));
  await p.evaluate(() => document.querySelector('#july-recording-panel').shadowRoot.querySelector('.primary').click());
  assert.equal(await p.evaluate(() => messages.some(message => message.type === 'recording.start')), false);
  assert.match(await p.locator('#july-recording-panel').locator('.shortcut').textContent(), /Alt\+Shift\+R/);
  await p.getByRole('button', { name: 'Ghi âm', exact: true }).click();
  assert.equal(await p.evaluate(() => messages.filter(message => message.type === 'recording.start').length), 1);
  await p.getByRole('button', { name: 'Dừng ghi âm' }).click();
  assert.equal(await p.evaluate(() => stops), 1);
  assert.equal(await p.getByRole('status').textContent(), 'Đã lưu trên máy · Chờ kết nối upload');
  await p.getByRole('button', { name: 'Bản ghi trên máy' }).click();
  assert.equal(await p.evaluate(() => messages.at(-1).type), 'recordings.open');
  await p.getByRole('button', { name: 'Cài đặt July' }).click();
  assert.equal(await p.evaluate(() => messages.at(-1).type), 'settings.open');
});

test('recording errors and idle status remain visible in compact mode', async t => {
  const p = await fixture(t);
  await p.evaluate(() => panel.updateMeeting({ inCall: true, meetingUrl: 'https://meet.google.com/abc-defg-hij' }));
  await p.getByRole('button', { name: 'Thu gọn' }).click();
  assert.equal(await p.getByRole('status').isVisible(), true);
  await p.evaluate(() => emitState({ status: 'error', error: 'Cần cấp quyền micro cho July' }));
  assert.equal(await p.getByRole('alert').textContent(), 'Cần cấp quyền micro cho July');
  assert.equal(await p.getByRole('button', { name: 'Cách bắt đầu ghi âm', exact: true }).count(), 0);
});

test('panel typography is isolated from the host page defaults', async t => {
  const p = await fixture(t);
  const font = await p.locator('#july-recording-panel').evaluate(host => getComputedStyle(host.shadowRoot.querySelector('.panel')).fontFamily);
  assert.match(font, /system-ui/);
});

test('capture that may remain active after a cleanup error keeps a usable Stop control', async t => {
  const p = await fixture(t);
  await p.evaluate(() => {
    panel.updateMeeting({ inCall: true, meetingUrl: 'https://meet.google.com/abc-defg-hij' });
    emitState({ status: 'error', error: 'Không liên lạc được bộ ghi âm' }, true);
  });
  await p.getByRole('button', { name: 'Dừng ghi âm', exact: true }).click({ timeout: 2000 });
  assert.equal(await p.evaluate(() => stops), 1);
});

test('auto-stop ignores hidden call controls and stops only after sustained absence', async t => {
  const p = await fixture(t);
  await p.evaluate(() => {
    window.fakeNow = Date.now(); Date.now = () => fakeNow;
    document.querySelector('main').innerHTML = '<button aria-label="Leave call" hidden>End</button>';
    panel.updateMeeting({ inCall: true, meetingUrl: 'https://meet.google.com/abc-defg-hij' });
    emitState({ status: 'recording', startedAt: new Date().toISOString() });
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
  await p.evaluate(() => emitState({ status: 'recording', startedAt: new Date().toISOString() }));
  await p.evaluate(() => {
    currentRoom = 'https://meet.google.com/xxx-yyyy-zzz';
    panel.updateMeeting({ inCall: true, meetingUrl: currentRoom });
  });
  await p.waitForTimeout(1100);
  assert.equal(await p.evaluate(() => stops), 1);
});

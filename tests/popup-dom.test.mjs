import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(__dirname, '../popup.html'), 'utf8');

test('popup.html contains all required functional DOM IDs for popup.js', () => {
  const requiredIds = [
    'conn-badge',
    'today',
    'conn-off',
    'connect',
    'connect-dashboard',
    'open-dashboard',
    'conn-on',
    'avatar',
    'conn-email',
    'disconnect',
    'conn-state',
    'conn-error',
    'refresh',
    'open-recordings',
    'recordings-title',
    'recordings-empty',
    'recordings-preview',
    'account-card',
    'state-dot',
    'state',
    'room',
    'bot',
    'schedule',
    'start',
    'end',
    'days',
    'reminder-minutes',
    'schedule-status'
  ];

  for (const id of requiredIds) {
    const hasId = html.includes(`id="${id}"`) || html.includes(`id='${id}'`);
    assert.ok(hasId, `popup.html must contain element with id="${id}"`);
  }
});

test('popup.html includes stylesheet and popup.js module', () => {
  assert.ok(html.includes('href="popup.css"'), 'Must link popup.css');
  assert.ok(html.includes('src="popup.js"'), 'Must include popup.js');
  assert.ok(html.includes('type="module"'), 'popup.js must be loaded as module');
});

test('options page is presented as a full settings page', () => {
  assert.match(html, /<title>Cài đặt · July Meeting Bot<\/title>/);
  assert.match(html, /class="page-label">Cài đặt extension<\/p>/);
  assert.match(html, /id="schedule-settings"[^>]*\shidden/);
  assert.doesNotMatch(html, /Cài đặt nâng cao/);
  assert.doesNotMatch(html, /bot tự động tham gia/);
  assert.doesNotMatch(html, /<details/);
  assert.doesNotMatch(html, /id="backend-url"/);
  assert.doesNotMatch(html, /id="recording-title"/);
  assert.doesNotMatch(html, /id="recording-toggle"/);
});

test('settings page has the requested responsive card layout', () => {
  assert.match(html, /id="app-main" class="app-main"/);
  assert.match(html, /class="card recordings-card"/);
  assert.match(html, /class="card account-card"/);
  assert.match(html, /id="schedule-settings"[^>]*\shidden/);
});

test('schedule form inputs have correct name attributes and required tags', () => {
  assert.ok(html.includes('name="start"'), 'Start time input must have name="start"');
  assert.ok(html.includes('name="end"'), 'End time input must have name="end"');
  assert.ok(html.includes('name="reminderMinutes"'), 'Reminder input must have name="reminderMinutes"');
  assert.match(html, /id="reminder-minutes"[\s\S]*option value="10"/);
});

test('local recordings preview is limited to six expandable items with download action', () => {
  const popup = readFileSync(resolve(__dirname, '../popup.js'), 'utf8');
  assert.match(popup, /records\.slice\(0, 6\)/);
  assert.match(popup, /recording-preview-details/);
  assert.match(popup, /recording-preview-download/);
  assert.match(popup, /getBlob\(record\.id\)/);
});

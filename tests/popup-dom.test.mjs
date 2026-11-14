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
    'backend-url',
    'conn-on',
    'avatar',
    'conn-email',
    'disconnect',
    'conn-state',
    'conn-error',
    'refresh',
    'state-dot',
    'state',
    'room',
    'bot',
    'schedule',
    'start',
    'end',
    'days',
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

test('schedule form inputs have correct name attributes and required tags', () => {
  assert.ok(html.includes('name="start"'), 'Start time input must have name="start"');
  assert.ok(html.includes('name="end"'), 'End time input must have name="end"');
});

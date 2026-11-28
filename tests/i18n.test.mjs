import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_LANGUAGE, LANGUAGE_KEY, MESSAGES, getMessages, loadLanguage, normalizeLanguage, saveLanguage } from '../i18n.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function memoryStorage(initial = {}) {
  const store = { ...initial };
  return {
    async get(key) { return { [key]: store[key] }; },
    async set(values) { Object.assign(store, values); },
  };
}

test('normalizeLanguage defaults to vi and supports en', () => {
  assert.equal(DEFAULT_LANGUAGE, 'vi');
  assert.equal(normalizeLanguage('en'), 'en');
  assert.equal(normalizeLanguage('vi'), 'vi');
  assert.equal(normalizeLanguage('fr'), 'vi');
  assert.equal(normalizeLanguage(undefined), 'vi');
});

test('loadLanguage and saveLanguage persist to storage', async () => {
  const storage = memoryStorage();
  assert.equal(await loadLanguage(storage), 'vi');
  assert.equal(await saveLanguage(storage, 'en'), 'en');
  assert.equal((await storage.get(LANGUAGE_KEY))[LANGUAGE_KEY], 'en');
  assert.equal(await loadLanguage(storage), 'en');
});

test('every data-i18n key in extension HTML pages exists in both vi and en dictionaries', () => {
  for (const file of ['../popup.html', '../recordings.html', '../microphone.html']) {
    const html = readFileSync(resolve(__dirname, file), 'utf8');
    const keys = [...html.matchAll(/data-i18n="([^"]+)"/g)].map(match => match[1]);
    assert.ok(keys.length > 0, `${file} must declare data-i18n keys`);
    for (const key of keys) {
      assert.equal(typeof MESSAGES.vi[key], 'string', `Missing vi translation for ${key} in ${file}`);
      assert.equal(typeof MESSAGES.en[key], 'string', `Missing en translation for ${key} in ${file}`);
    }
  }
  assert.equal(Object.keys(MESSAGES.vi).length, Object.keys(MESSAGES.en).length);
  assert.equal(getMessages('en').docTitle, 'Settings · July Meeting Bot');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_UPLOAD_MINUTES, UPLOAD_MINUTES_KEY, loadUploadMinutes, normalizeUploadMinutes, saveUploadMinutes } from '../recording-upload-settings.js';

test('upload duration setting normalizes invalid values and keeps zero unlimited', async () => {
  assert.equal(DEFAULT_UPLOAD_MINUTES, 3);
  assert.equal(normalizeUploadMinutes(0), 0);
  assert.equal(normalizeUploadMinutes('12'), 12);
  assert.equal(normalizeUploadMinutes(12.9), 12);
  assert.equal(normalizeUploadMinutes(-1), 3);
  assert.equal(normalizeUploadMinutes('garbage'), 3);
  const data = {};
  const storage = { get: async key => ({ [key]: data[key] }), set: async value => Object.assign(data, value) };
  assert.equal(await saveUploadMinutes(storage, '7'), 7);
  assert.equal(await loadUploadMinutes(storage), 7);
  data[UPLOAD_MINUTES_KEY] = -3;
  assert.equal(await loadUploadMinutes(storage), 3);
  delete data[UPLOAD_MINUTES_KEY];
  assert.equal(await loadUploadMinutes(storage), 3);
});

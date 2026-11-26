import { test } from 'node:test';
import assert from 'node:assert/strict';

const { uploadToSignedUrl } = await import('../signed-upload.js').catch(() => ({ uploadToSignedUrl: () => { throw new Error('signed upload not implemented'); } }));

test('signed PUT preserves URL and signed headers while excluding browser credentials', async () => {
  let request;
  const blob = new Blob(['audio'], { type: 'audio/webm' });
  const signed = { url: 'https://bucket.r2.cloudflarestorage.com/meet.webm?X-Amz-Signature=abc%2F123', headers: { 'Content-Type': 'audio/webm', 'x-amz-meta-room': 'abc-defg-hij' } };
  const controller = new AbortController();
  await uploadToSignedUrl(blob, signed, { signal: controller.signal, fetchImpl: async (url, init) => { request = { url, init }; return new Response(null, { status: 200 }); } });
  assert.equal(request.url, signed.url);
  assert.equal(request.init.method, 'PUT');
  assert.deepEqual(request.init.headers, signed.headers);
  assert.equal(request.init.body, blob);
  assert.equal(request.init.credentials, 'omit');
  assert.equal(request.init.redirect, 'error');
  assert.equal(request.init.signal, controller.signal);
  assert.equal(request.init.headers.authorization, undefined);
});

test('signed URL validation refuses insecure or embedded credentials before fetching', async () => {
  let calls = 0;
  for (const url of ['http://bucket.test/file', 'https://user:password@bucket.test/file', 'not-a-url']) {
    await assert.rejects(async () => uploadToSignedUrl(new Blob(['audio']), { url }, { fetchImpl: async () => { calls++; return new Response(); } }));
  }
  assert.equal(calls, 0);
});

test('HTTP failures and transport failures surface without treating upload as delivered', async () => {
  const blob = new Blob(['audio']);
  await assert.rejects(() => uploadToSignedUrl(blob, { url: 'https://bucket.test/file' }, { fetchImpl: async () => new Response(null, { status: 403 }) }), /403/);
  await assert.rejects(() => uploadToSignedUrl(blob, { url: 'https://bucket.test/file' }, { fetchImpl: async () => { throw new Error('offline'); } }), /offline/);
});

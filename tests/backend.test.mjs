import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api, connect, getConnection, normalizeBackendUrl, setBackendUrl } from '../backend.js';
function storage() {
 const data = {};
 return { data, get: async key => ({ [key]: structuredClone(data[key]) }), set: async values => Object.assign(data, structuredClone(values)) };
}
test('backend URL is validated, defaults to localhost, and changing it drops the token', async () => {
 assert.equal(normalizeBackendUrl(' https://bot.urbox.dev/ '), 'https://bot.urbox.dev');
 for (const bad of ['ftp://x', 'not a url', 'https://u:p@x', 'https://x/?q=1']) assert.throws(() => normalizeBackendUrl(bad));
 const s = storage();
 assert.equal((await getConnection(s)).backendUrl, 'http://localhost:4000');
 s.data.backendConnection = { backendUrl: 'http://localhost:4000', token: 't', email: 'e' };
 await setBackendUrl(s, 'http://localhost:4000/');
 assert.equal((await getConnection(s)).token, 't');
 await setBackendUrl(s, 'https://other.example');
 assert.equal((await getConnection(s)).token, null);
});
test('connect reads token/email from the redirect fragment, or surfaces the error', async () => {
 const s = storage();
 const identity = fragment => ({
  getRedirectURL: () => 'https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/',
  launchWebAuthFlow: async ({ url }) => {
   assert.equal(url, 'http://localhost:4000/oauth/start?redirect_uri=https%3A%2F%2Fabcdefghijklmnopabcdefghijklmnop.chromiumapp.org%2F');
   return `https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/#${fragment}`;
  },
 });
 await assert.rejects(connect(s, identity('error=access_denied')), /access_denied/);
 assert.deepEqual(await connect(s, identity('token=abc&email=a%40example.com')), { backendUrl: 'http://localhost:4000', token: 'abc', email: 'a@example.com' });
});
test('api sends the bearer token; a 401 disconnects', async () => {
 const s = storage();
 s.data.backendConnection = { backendUrl: 'http://b', token: 'tok', email: 'e' };
 const ok = async (url, init) => { assert.equal(url, 'http://b/api/me'); assert.equal(init.headers.authorization, 'Bearer tok'); return new Response('{"email":"e"}', { status: 200 }); };
 assert.deepEqual(await api(s, 'GET', '/api/me', undefined, ok), { email: 'e' });
 await assert.rejects(api(s, 'GET', '/api/me', undefined, async () => new Response('{}', { status: 401 })), /kết nối lại/);
 assert.equal((await getConnection(s)).token, null);
});

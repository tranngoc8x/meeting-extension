import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DASHBOARD_AUTHORIZE_PATH, api, connect, getConnection, normalizeBackendUrl, openDashboard, setBackendUrl } from '../backend.js';
function storage() {
 const data = {};
 return { data, get: async key => ({ [key]: structuredClone(data[key]) }), set: async values => Object.assign(data, structuredClone(values)) };
}
test('backend URL is validated, defaults to localhost, and changing it drops the token', async () => {
 assert.equal(normalizeBackendUrl(' https://bot.urbox.dev/ '), 'https://bot.urbox.dev');
 for (const bad of ['ftp://x', 'not a url', 'https://u:p@x', 'https://x/?q=1']) assert.throws(() => normalizeBackendUrl(bad));
 const s = storage();
 assert.equal((await getConnection(s)).backendUrl, 'https://api.july.io.vn');
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
   assert.equal(url, 'https://api.july.io.vn/oauth/start?redirect_uri=https%3A%2F%2Fabcdefghijklmnopabcdefghijklmnop.chromiumapp.org%2F');
   return `https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/#${fragment}`;
  },
 });
 await assert.rejects(connect(s, identity('error=access_denied')), /access_denied/);
 assert.deepEqual(await connect(s, identity('token=abc&email=a%40example.com')), { backendUrl: 'https://api.july.io.vn', token: 'abc', email: 'a@example.com' });
});
test('api sends the bearer token; a 401 disconnects', async () => {
 const s = storage();
 s.data.backendConnection = { backendUrl: 'http://b', token: 'tok', email: 'e' };
 const ok = async (url, init) => { assert.equal(url, 'http://b/api/me'); assert.equal(init.headers.authorization, 'Bearer tok'); return new Response('{"email":"e"}', { status: 200 }); };
 assert.deepEqual(await api(s, 'GET', '/api/me', undefined, ok), { email: 'e' });
 await assert.rejects(api(s, 'GET', '/api/me', undefined, async () => new Response('{}', { status: 401 })), /kết nối lại/);
 assert.equal((await getConnection(s)).token, null);
});
test('connect via dashboard authorize builds the URL, stores the token, surfaces #error', async () => {
 const s = storage();
 const redirect = 'https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/';
 const identity = fragment => ({
  getRedirectURL: () => redirect,
  launchWebAuthFlow: async ({ url, interactive }) => {
   assert.equal(url, `https://api.july.io.vn/dashboard/v2/extension/authorize?redirect_uri=${encodeURIComponent(redirect)}`);
   assert.equal(interactive, true);
   return `${redirect}#${fragment}`;
  },
 });
 await assert.rejects(connect(s, identity('error=access_denied'), DASHBOARD_AUTHORIZE_PATH), /access_denied/);
 assert.equal((await getConnection(s)).token, null);
 await connect(s, identity('token=dash&email=d%40example.com'), DASHBOARD_AUTHORIZE_PATH);
 assert.deepEqual(s.data.backendConnection, { backendUrl: 'https://api.july.io.vn', token: 'dash', email: 'd@example.com' });
});
test('openDashboard exchanges the token for a one-time link and opens it; 401 disconnects', async () => {
 const s = storage();
 s.data.backendConnection = { backendUrl: 'http://b', token: 'tok', email: 'e' };
 const opened = [];
 const tabs = { create: async props => { opened.push(props); } };
 const ok = async (url, init) => {
  assert.equal(url, 'http://b/dashboard/v2/auth/extension-code');
  assert.equal(init.method, 'POST');
  assert.equal(init.headers.authorization, 'Bearer tok');
  assert.equal(init.headers['content-type'], 'application/json');
  assert.equal(init.body, '{}');
  return new Response('{"url":"/dashboard/v2/auth/extension?code=c1"}', { status: 200 });
 };
 await openDashboard(s, tabs, ok);
 assert.deepEqual(opened, [{ url: 'http://b/dashboard/v2/auth/extension?code=c1' }]);
 for (const bad of ['//evil.example/x', 'https://evil.example/x', '@evil.example', undefined]) {
  await assert.rejects(openDashboard(s, tabs, async () => Response.json({ url: bad })), /không hợp lệ/);
 }
 assert.equal(opened.length, 1);
 await assert.rejects(openDashboard(s, tabs, async () => new Response('{}', { status: 401 })), /Phiên tiện ích hết hạn, hãy kết nối lại/);
 assert.equal((await getConnection(s)).token, null);
 assert.equal(opened.length, 1);
});

test('legacy localhost backend migrates to the server and drops its token', async () => {
  const { migrateLegacyBackend, DEFAULT_BACKEND_URL } = await import('../backend.js');
  const store = data => ({ data, async get(k) { return { [k]: this.data[k] }; }, async set(v) { Object.assign(this.data, v); } });
  const legacy = store({ backendConnection: { backendUrl: 'http://localhost:4000', token: 'old', email: 'e' } });
  assert.equal(await migrateLegacyBackend(legacy), true);
  assert.deepEqual(legacy.data.backendConnection, { backendUrl: DEFAULT_BACKEND_URL });
  const custom = store({ backendConnection: { backendUrl: 'https://staging.example.invalid', token: 't' } });
  assert.equal(await migrateLegacyBackend(custom), false);
  assert.equal(custom.data.backendConnection.token, 't');
  assert.equal(await migrateLegacyBackend(store({})), false);
});

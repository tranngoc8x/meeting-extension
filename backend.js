// Connection to meeting-scheduler. The API token lives in chrome.storage.local, which
// background.js restricts to trusted extension contexts (content scripts cannot read it).
export const CONNECTION_KEY = 'backendConnection';
export const DEFAULT_BACKEND_URL = 'http://localhost:4000';
export const backendStatusKey = tabId => `meet-backend:${tabId}`;

export async function getConnection(storage) {
  const saved = (await storage.get(CONNECTION_KEY))[CONNECTION_KEY] ?? {};
  return { backendUrl: saved.backendUrl || DEFAULT_BACKEND_URL, token: saved.token ?? null, email: saved.email ?? null };
}

export function normalizeBackendUrl(value) {
  let url;
  try { url = new URL(String(value).trim()); } catch { throw new Error('Địa chỉ backend không hợp lệ'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('Địa chỉ backend phải là http(s)://host[:port]');
  }
  return url.href.replace(/\/$/, '');
}

/** Changing the backend drops the token: it belongs to the old server. */
export async function setBackendUrl(storage, value) {
  const backendUrl = normalizeBackendUrl(value);
  const current = await getConnection(storage);
  if (backendUrl !== current.backendUrl) await storage.set({ [CONNECTION_KEY]: { backendUrl } });
  return backendUrl;
}

/** Google sign-in through the backend; it redirects back with #token=…&email=… or #error=…. */
export async function connect(storage, identity) {
  const { backendUrl } = await getConnection(storage);
  const start = `${backendUrl}/oauth/start?redirect_uri=${encodeURIComponent(identity.getRedirectURL())}`;
  const result = new URL(await identity.launchWebAuthFlow({ url: start, interactive: true }));
  const fragment = new URLSearchParams(result.hash.slice(1));
  if (!fragment.get('token')) throw new Error(fragment.get('error') || 'Đăng nhập không thành công');
  const connection = { backendUrl, token: fragment.get('token'), email: fragment.get('email') };
  await storage.set({ [CONNECTION_KEY]: connection });
  return connection;
}

export async function disconnect(storage) {
  const { backendUrl } = await getConnection(storage);
  await storage.set({ [CONNECTION_KEY]: { backendUrl } });
}

export async function api(storage, method, path, body, fetchImpl = fetch) {
  const { backendUrl, token } = await getConnection(storage);
  if (!token) throw new Error('Chưa kết nối backend');
  const response = await fetchImpl(`${backendUrl}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await response.json().catch(() => ({}));
  if (response.status === 401) {
    await disconnect(storage);
    throw new Error('Phiên kết nối hết hạn, hãy kết nối lại');
  }
  if (!response.ok) throw new Error(json.error || `Backend lỗi ${response.status}`);
  return json;
}

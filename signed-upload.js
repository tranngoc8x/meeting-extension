/** Transport only. The backend's presign/finalize contract is intentionally not inferred. */
export async function uploadToSignedUrl(blob, { url, headers = {} }, { fetchImpl = fetch, signal } = {}) {
  const target = new URL(url);
  if (target.protocol !== 'https:' || target.username || target.password || target.hash) throw new Error('A signed HTTPS upload URL is required');
  const response = await fetchImpl(url, {
    method: 'PUT',
    headers,
    body: blob,
    credentials: 'omit',
    redirect: 'error',
    signal,
  });
  if (!response.ok) throw new Error(`R2 upload failed (HTTP ${response.status})`);
  return response;
}

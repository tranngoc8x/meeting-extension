# July Meeting Bot (Chrome extension)

Manifest V3 extension, no build step. Works with [meeting-scheduler](../meeting-scheduler):

- **Kết nối Google:** popup → nhập địa chỉ backend (mặc định `https://api.july.io.vn`; khi dev đổi thành `http://localhost:4000`) → _Kết nối Google_. The service worker runs `chrome.identity.launchWebAuthFlow` against the backend's `/oauth/start`; the backend returns an API token in the redirect fragment, stored in `chrome.storage.local` (trusted contexts only, content scripts cannot read it).
- **Kết nối bằng tài khoản dashboard:** khi đã đăng nhập dashboard, nút _Kết nối bằng tài khoản dashboard_ chạy `launchWebAuthFlow` tới `/dashboard/v2/extension/authorize`; dashboard hỏi xác nhận rồi trả về cùng fragment `#token=…&email=…` (hoặc `#error=…`) như luồng Google, xử lý chung trong `connect()`.
- **Mở dashboard:** khi đã kết nối, nút _Mở dashboard_ gọi `POST /dashboard/v2/auth/extension-code` (Bearer token) lấy link dùng một lần rồi mở tab mới (`chrome.tabs.create`, không cần permission `tabs`). Link chỉ được mở nếu là đường dẫn trên chính backend. 401 = token hết hạn: tiện ích tự ngắt kết nối.
- **Lịch quét họp:** start/end time and weekdays (default 08:30-18:30, Mon-Fri), saved in `chrome.storage.sync` (`scanSchedule`) and pushed to the backend (`PUT /api/settings`) when connected.
- **In-call detection:** when the user enters a Meet call, the background sends `POST /integrations/in-call`; the backend asks the bot to join now and deduplicates rooms that already have a bot. The popup shows the result for the active tab.

## Load unpacked

Open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select this folder. Copy the extension ID into the backend's `EXTENSION_IDS`. Open or reload a Google Meet tab after loading or reloading the extension. Chrome 111+ is required. No build or npm install is needed to load it.

Permissions: `storage`, `identity`. The backend is reached with CORS (no host permissions).

## Detection boundaries

An initial check handles loading into an existing call. A visible enabled Leave call button (English/Vietnamese labels or `call_end` Google icon) inside `main`/`role=main` is the heuristic. Prejoin and waiting fixtures do not contain this signal. Meet DOM is undocumented: unsupported layouts/languages can produce false negatives, and hidden/changed controls may affect detection. Real Meet verification is still required.

MutationObserver observes the main region with filtered attributes and relevant changed subtrees. Direct-child observers on its ancestor chain detect replacement; a temporary child-list discovery observer finds a late main region. Batches are coalesced with a 50 ms one-shot timeout, never an interval. The detector does not scan the whole document per mutation. It disconnects observers and navigation listeners on stop/rebind. Content pagehide cancels pending retry timers and observers; BFCache pageshow restarts detection. No leave or bot-stop request is inferred from tab closure.

Only transitions produce local extension messages. The service worker serializes storage changes and keeps one latest event per tab in chrome.storage.local, restricted to trusted extension contexts. Retries reuse the same candidate requestId; an initial in-call observation after a page reload reuses the saved active room requestId. Observed leave/rejoin or a different room creates a new ID. Tab close removes its entry; browser startup clears old tab keys. Failed storage is exposed as a local-save failure with three bounded attempts. Closing a page before saving can lose its event. Unobserved leave/rejoin gaps can reuse the previous ID. Different tabs are independent. None of this guarantees server deduplication or identifies a backend meeting session.

Navigation is checked on initial load, relevant DOM changes, popstate and hashchange. A history pushState with no relevant DOM mutation is not independently detected. Only HTTPS Google Meet room codes in `xxx-xxxx-xxx` form are accepted; query and fragment are removed. Lookup/nickname links are unsupported.

## Tests

Run `npm ci` once, then `npm test`. Node 20+ and Playwright plus a Chrome browser are needed only for tests. Playwright is declared as a test-only dependency here; Runtime needs no npm packages or build. Tests default to the installed Chrome channel; `CHROME_CHANNEL=chromium npm test` uses Playwright Chromium if installed. `npm run validate` checks the manifest's scope, permissions and entry points.

Browser DOM fixtures cover initial in-call, prejoin/waiting, joining/leaving, repeated mutations, hidden/disabled controls, late/replaced roots, localization/icon fallback, URL changes, unrelated mutations and teardown. Node tests cover persistence continuity, retry, storage failure and validation. Tests were written and observed RED before implementation. Fixture evidence does not establish real Meet correctness, long-call CPU/memory cost, 1–2 second production latency or real Chrome extension lifecycle correctness.

## Integration notes

The backend (meeting-scheduler) owns idempotency: the extension reports each new in-call transition once per requestId, and the backend skips rooms that already have a bot. A `dispatched` reply means the bot was asked to join, not that it was admitted or is recording. The in-call heuristic still needs validation on real Meet flows (admission, reconnect, room change).

The implementation follows official Chrome documentation consulted on 2026-11-13: [content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts), [storage](https://developer.chrome.com/docs/extensions/reference/api/storage), and [message passing](https://developer.chrome.com/docs/extensions/develop/concepts/messaging). Content scripts are classic isolated-world files because declarative scripts do not use static module imports; the service worker and popup use plain JS modules. Only `storage` + `identity` permissions and Meet-scoped declarative injection are requested; no microphone, tab capture, tabs, or all-sites permission.

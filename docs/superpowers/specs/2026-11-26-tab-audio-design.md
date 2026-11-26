# Audio-only tab capture migration

## Final clarified UX — v0.4.2

Tony explicitly selected: icon opens the July control popup shown in his screenshot; popup and floating card both expose actual Start/Stop. This supersedes the v0.4.1 direct toolbar-toggle interpretation. The unwanted large screen was confirmed as microphone.html, so its helper now uses a focused 460×420 Chrome popup window with the same automatic handoff/close. Account/settings remain in the existing popup, with the options link retained for explicit settings use.

Floating Start accepts only a trusted physical UI click in the owned top-frame Meet document. Background uses actual sender identity, real tab URL/canonical room and document-targeted status checks before/around stream-ID acquisition. Missing native tab invocation fails before any helper/audio with a clear one-time icon instruction; Chrome tabCapture permission still enforces authorization. Opening the real action popup grants access to that tab; stopping does not revoke it, so subsequent floating Start works. No synthetic DOM click, arbitrary caller tab ID, stale document or changed room may start capture. Native acceptance covers both popup buttons, both float buttons, small helper-window type/bounds, absence of extra helper on restart and decoded audio.

## UX correction — v0.4.1

Tony rejected the extra popup/Record step and permission-page keep-open/manual-restart workflow. The toolbar action now directly toggles Meet capture. Settings move to the existing popup.html as an options tab, also accessible through a useful Settings control on the floating card. Idle card shows status; remove the guidance-only button. First-use microphone setup automatically requests browser permission, holds its acquired stream until the waiting offscreen recording is established, releases that setup stream and closes itself after acknowledgement. Resume only the original trusted pending tab/room, cancel stale/closed/navigated intents, and enforce actual getUserMedia permission even when the Permissions API reports prompt. Subsequent icon clicks start directly. Verify both journeys with a fresh native profile without globally pregranting microphone permission; earlier native coverage that pregranted permission does not establish first-use UX correctness. These requirements supersede the popup/start and manual permission-return flow below.

Tony approved replacing the screen-sharing flow with chrome.tabCapture. The floating Meet card remains a prominent reminder/status/Stop control; starting uses the extension popup or a recording shortcut. Never fall back to getDisplayMedia or present a screen/window picker.

## Approach

Use a Chrome 116+ service worker to acquire a fresh tab stream ID after extension invocation. An extension offscreen document consumes it with audio-only getUserMedia constraints, mixes microphone audio, restores tab-only playback to speakers and persists to the existing IndexedDB format. Only one recording is active at a time. Popup keeps existing account/bot controls plus a clear recording action. Default recording shortcut: Alt+Shift+R; show the actual assigned shortcut from chrome.commands, because Chrome may reject a conflicting assignment.

Microphone permission belongs to the extension origin now. A visible microphone setup page requests it once, stops its test stream immediately, and tells users to return to Meet and invoke July again. Offscreen code checks permission before tab capture. Revoked permission is visible and recoverable. Meet mute still does not mute this independent microphone capture; state that in the UI.

## Safety and lifecycle

Only popup/command may start. Content scripts may request their own tab's status/stop/library, never pass stream IDs or audio bytes. Offscreen accepts only extension-owned control messages; the worker accepts state only from its exact offscreen document. Persist active status in session storage and reconcile with the live offscreen document on worker restart. Do not mark active offscreen captures interrupted merely because a worker restarted. Stop on explicit command/card/popup, source ending, tab close, document navigation/reload, room change or sustained departure from the call. The content card detects leave controls by presence, with six-second absence confirmation. Background owns close/navigation stop, so removing the page cannot strand capture.

Existing recordings, chunk schema, downloads and signed-R2 boundary remain readable and unchanged. Old content-script chunk-writing messages are retired from the runtime boundary. Keep R2 orchestration deferred in meet-ext-736. Rollback is the prior commit and does not require a data migration.

## Proof

Test audio-only tab constraints (no display capture), tab playback routing without microphone feedback, permission setup, controller invocation restrictions, one active session, source/mic loss and startup cancellation, final chunk persistence, state across worker restart and storage compatibility. Validate native tabCapture in an isolated test extension/browser when available. Distinguish mocks, real media encoding and real joined Meet acceptance.

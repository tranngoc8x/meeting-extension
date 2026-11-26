# Audio-only tab capture migration

Tony approved replacing the screen-sharing flow with chrome.tabCapture. The floating Meet card remains a prominent reminder/status/Stop control; starting uses the extension popup or a recording shortcut. Never fall back to getDisplayMedia or present a screen/window picker.

## Approach

Use a Chrome 116+ service worker to acquire a fresh tab stream ID after extension invocation. An extension offscreen document consumes it with audio-only getUserMedia constraints, mixes microphone audio, restores tab-only playback to speakers and persists to the existing IndexedDB format. Only one recording is active at a time. Popup keeps existing account/bot controls plus a clear recording action. Default recording shortcut: Alt+Shift+R; show the actual assigned shortcut from chrome.commands, because Chrome may reject a conflicting assignment.

Microphone permission belongs to the extension origin now. A visible microphone setup page requests it once, stops its test stream immediately, and tells users to return to Meet and invoke July again. Offscreen code checks permission before tab capture. Revoked permission is visible and recoverable. Meet mute still does not mute this independent microphone capture; state that in the UI.

## Safety and lifecycle

Only popup/command may start. Content scripts may request their own tab's status/stop/library, never pass stream IDs or audio bytes. Offscreen accepts only extension-owned control messages; the worker accepts state only from its exact offscreen document. Persist active status in session storage and reconcile with the live offscreen document on worker restart. Do not mark active offscreen captures interrupted merely because a worker restarted. Stop on explicit command/card/popup, source ending, tab close, document navigation/reload, room change or sustained departure from the call. The content card detects leave controls by presence, with six-second absence confirmation. Background owns close/navigation stop, so removing the page cannot strand capture.

Existing recordings, chunk schema, downloads and signed-R2 boundary remain readable and unchanged. Old content-script chunk-writing messages are retired from the runtime boundary. Keep R2 orchestration deferred in meet-ext-736. Rollback is the prior commit and does not require a data migration.

## Proof

Test audio-only tab constraints (no display capture), tab playback routing without microphone feedback, permission setup, controller invocation restrictions, one active session, source/mic loss and startup cancellation, final chunk persistence, state across worker restart and storage compatibility. Validate native tabCapture in an isolated test extension/browser when available. Distinguish mocks, real media encoding and real joined Meet acceptance.

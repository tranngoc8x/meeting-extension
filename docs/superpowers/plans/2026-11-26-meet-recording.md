# Meet recording implementation plan

**Goal:** implement approved inline Meet recording, durable local files, and a signed-R2 transport boundary.

**Spec:** ../specs/2026-11-26-meet-recording-design.md

**Architecture:** vanilla MV3 extension. A classic content recorder owns browser media streams. Validated service-worker messages persist chunks to extension IndexedDB. An extension page owns local downloads. No new dependencies or capture host permissions.

**Tracking:** meet-ext-kut tracks implementation/review; meet-ext-736 tracks the deferred backend contract. Beads is authoritative; this document is an implementation reference, not a parallel TODO list.

## Storage and signed transport

Create recording-store.js exposing createRecordingStore(indexedDB): begin(record), append(id, sequence, Blob), finish(id, patch), list(), getBlob(id), remove(id), interruptTab(tabId), recover(). Persist recording metadata separately from ordered chunk blobs; transactions enforce sequential/idempotent writes and terminal states. Create signed-upload.js exporting uploadToSignedUrl(blob, signed, options), with HTTPS validation, PUT, credentials omitted, redirects rejected and HTTP failure surfaced. Browser tests exercise real IndexedDB across store reopens and fetch transport fixtures exercise signed requests. Watch tests fail before implementation.

## Capture

Create recorder.js, a classic MeetingRecorder namespace with create({send,onState}) returning start({meetingUrl,title}), stop(), getState(). Invoke getDisplayMedia synchronously from start (no preceding awaits), request current tab + tab audio, then microphone; mix to an audio-only MediaStream. Send recording.begin, ordered base64 recording.chunk messages (id,sequence,data), then recording.finish (id,error?). Limit buffering by failing visibly when persistence cannot keep up. Free all tracks/context/timers on cancellation/error/stop. Browser tests cover cancellation/missing audio, cleanup, duplicate start, final ordering and an actual synthetic MediaRecorder/audio file.

## Integration and UI

Create recording-service.js to validate sender extension ID, Meet origin/top frame/canonical room, tab/document ownership, IDs and chunk sizes before store calls. Add one listener after existing listeners in background.js; handle library open only for trusted Meet senders, and recover/interruption via startup/tab closure. A restarted worker continues from persisted metadata. Add recording-ui.js, loaded after recorder.js and before content.js; isolate styles with Shadow DOM, expose updateMeeting(state), and wait six seconds before auto-stop, checking DOM presence of hangup controls. content.js connects existing detector transitions to the panel and tears down on pagehide. Create recordings.html/js/css for pending/interrupted files, download and explicit delete; add a link in popup. Update manifest entry points/version and README instructions/limits.

## Review focus and verification

Test storage failure and malformed/untrusted runtime inputs; recorders must never report saved when bytes were rejected. Hidden control bars must not truncate recordings. Stop during picker/start must release subsequently returned streams. Page closure may lose unacknowledged tail; label interrupted, preserve prior chunks. Signed transport must never leak backend tokens or follow credential-bearing redirects. Existing bot dispatch behavior must remain green.

Run focused Node/browser tests during each task and npm test for regression. Inspect git diff/check and run JavaScript syntax checks. Review the complete change independently, address material findings with regression tests, and update Beads with evidence. No deployment or live upload until the contract exists.

## Review result — 2026-11-26

Implemented the capture, local library and signed-PUT boundary. `npm test`: 51/51 passed, including a native Chrome getDisplayMedia picker automated on a synthetic audio tab with a fake microphone, actual WebM encoding/decoding, runtime message routing through the production background module with a mocked Chrome runtime, real IndexedDB persistence, and download verification. JavaScript syntax and `git diff --check` passed. An independent static reviewer found no actionable issues. Final self-review added a regression for flushing the original recording after same-document navigation; ownership now relies on tab + document ID while initial creation still validates the canonical room.

No signed-in live Meet session, real R2 upload, or deployment was performed. Automatic presign/PUT/completion orchestration remains in meet-ext-736 pending the explicitly deferred contract. Microphone capture is independent of Meet mute, stated in both the panel and README. Navigation/closure may lose unacknowledged tail audio; interrupted local files are labeled accordingly.

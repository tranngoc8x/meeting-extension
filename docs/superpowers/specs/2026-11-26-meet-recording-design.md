# In-page Meet audio recording

Tony approved option 1: a visible button inside Google Meet opens Chrome's tab-sharing picker. Capture is initiated directly by the click. Record tab sound and microphone into one audio-only WebM/Opus file. Keep existing bot dispatch and account flows.

## Approaches

Selected: content-script capture with `getDisplayMedia`, explicit picker approval each time. The recorder lives in the Meet document; navigating/reloading/closing it ends capture. Incremental chunks are persisted in the extension's IndexedDB through validated runtime messages. Local bytes are never stored in Meet's origin.

Alternative: `tabCapture` with an extension toolbar invocation or keyboard shortcut. Rejected because the user wants a prominent button that actually starts capture from Meet. A recording window would require another click and is unnecessary for this scope.

## Behavior

Use a Shadow DOM floating panel with Record/Stop, elapsed time, a compact mode, and a local-recordings link. Show it on canonical Meet room URLs. Instruct users to select the meeting tab and share tab audio. Abort with a visible error when audio or microphone is missing; release every acquired track. Only mixed audio goes into MediaRecorder; captured video is never recorded. Never play the microphone through speakers.

Save periodic chunks without retaining the whole meeting in RAM. Acknowledge persisted chunks before finalizing. Explicit stop and end-of-sharing finalize the file. Call-exit detection waits six seconds and ignores temporarily hidden controls still present in the DOM. Browser/tab interruption preserves acknowledged chunks and labels the recording interrupted, without claiming the final tail was saved. Download/delete are available on an extension-owned recordings page; recording entries cannot be deleted while active.

## Upload boundary

The user explicitly deferred the contract and specified signed R2 uploads. Implement a separately testable HTTPS signed-PUT primitive, preserving signed headers and omitting application credentials. Do not invent presign/finalize endpoints, add speculative host permissions, or reuse the old gateway. Local completed files remain pending with the label “Chờ kết nối upload”. Connect automatic upload once the user supplies the contract (Bead meet-ext-736).

## Verification and limits

Verify IndexedDB persistence/order/delete, trusted message routing, picker cancellation, missing tab sound/mic denial, audio-only output, stop/final chunk ordering, chunk storage failure, duplicate starts, hidden Meet controls, local downloads, and signed PUT failures. Use browser fixtures plus a synthetic real MediaRecorder capture; a signed-in live Meet call and real R2 delivery remain separate acceptance checks.

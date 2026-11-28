# Extension Authenticated Recording Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Upload completed local recordings when the extension already has a valid backend token, using the documented session, signed PUT, and finish API flow.

**Architecture:** Keep binary transport in `signed-upload.js`; add a testable orchestration module that uses the existing authenticated `api()` helper for metadata and the existing IndexedDB store for bytes. Trigger uploads from the trusted offscreen completion path and retry pending records on service-worker startup, while leaving recordings local when no token is available or an upload fails.

**Tech Stack:** Chrome MV3, JavaScript ES modules, IndexedDB, Web Crypto SHA-256, Node test runner, Playwright.

**Spec:** `/private/tmp/july-meeting-upgrade/docs/extension-upload-api.md`.

## Global Constraints

- Metadata requests use `Authorization: Bearer <extension_token>` and JSON; never send owner, bucket, object key, or storage credentials from the extension.
- Use `POST /extension/v1/recordings`, `POST /extension/v1/recordings/{id}/upload-attempts`, signed `PUT`, then `POST /extension/v1/recordings/{id}/finish`.
- Upload only `audio/webm`; signed PUT must preserve required headers and omit browser credentials.
- Keep local data and allow retry when unauthenticated, offline, expired, or rejected.

## Review Focus

- Existing logged-in token is reused and a 401 clears the session through `api()`.
- Retry after a lost response reuses the stable local recording ID as `clientSessionId`.
- Signed headers are passed unchanged and application bearer credentials never reach R2.
- No-token and failed-upload paths retain the local recording.
- Service-worker restart discovers pending records without duplicating in-flight work.

### Task 1: Upload orchestration and persistence state

**Files:**
- Create: `recording-upload.js`
- Modify: `recording-store.js`
- Test: `tests/recording-upload.test.mjs`, `tests/recording-store.test.mjs`

**Interfaces:**
- `createRecordingUploader({ store, apiFn, signedPutFn, digestFn })` exposes `upload(record)` and `uploadPending()`.
- Store exposes `update(id, patch)` for upload metadata.

- [ ] Write failing tests for the exact API sequence, digest/body fields, signed headers, no-token retention, retry identity, and store update.
- [ ] Run the focused tests and observe failure because the uploader/update API is absent.
- [ ] Implement the minimal uploader and store update; normalize `audio/webm` and derive room from the Meet URL.
- [ ] Run focused tests until green, then run the full suite.

### Task 2: Wire completion and startup retry

**Files:**
- Modify: `offscreen.js`, `background.js`
- Test: `tests/offscreen.test.mjs`, `tests/background-upload.test.mjs`

**Interfaces:**
- Completion sends a trusted background message after `recording.finish` is persisted.
- Background owns one uploader, handles completion messages, and scans pending records on startup.

- [ ] Write failing tests for trusted completion notification and startup pending scan.
- [ ] Run focused tests and observe failure.
- [ ] Wire the uploader without blocking capture completion; preserve local recordings on upload errors.
- [ ] Run focused and full suites.

### Task 3: User-facing status

**Files:**
- Modify: `recordings.js`, `popup.js`
- Test: `tests/recordings-page.test.mjs`, `tests/popup-dom.test.mjs`

- [ ] Add failing assertions for queued/upload-error labels.
- [ ] Implement concise local status rendering and retry-safe refresh.
- [ ] Run the full suite and validate the manifest.

# Configurable Recording Upload Duration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let authenticated users configure the minimum meeting duration sent to the server, with `0` uploading every completed recording.

**Architecture:** Store a normalized minute threshold in `chrome.storage.sync`. Expose it in the existing signed-in settings section with the exact label requested by the user. The background uploader reads the setting and skips short recordings before any API/R2 call, retaining them locally.

**Tech Stack:** Chrome MV3, JavaScript ES modules, Chrome storage, Node test runner, existing Playwright DOM tests.

**Spec:** `docs/superpowers/specs/2026-11-27-recording-upload-duration-design.md`

## Global Constraints

- The label must be `Gửi bản ghi với các cuộc họp có độ dài xx phút`.
- `0` means no duration limit.
- Configuration and upload action require an authenticated extension token.
- Do not change the backend API or signed R2 transport contract.
- Short recordings remain local and must not trigger metadata or signed PUT requests.

## Review Focus

- No token means no upload and no configuration save from the settings UI.
- Exactly zero uploads a very short completed recording.
- A positive threshold compares completed duration in whole minutes.
- Invalid, empty, negative, and fractional values normalize safely.
- Existing pending records are re-evaluated when the threshold changes or the worker restarts.

### Task 1: Threshold normalization and uploader gate

**Files:**
- Create: `recording-upload-settings.js`
- Modify: `recording-upload.js`
- Test: `tests/recording-upload-settings.test.mjs`, `tests/recording-upload.test.mjs`

**Interfaces:**
- `UPLOAD_MINUTES_KEY` and `DEFAULT_UPLOAD_MINUTES = 3`.
- `normalizeUploadMinutes(value) -> number`.
- `loadUploadMinutes(storage) -> Promise<number>` and `saveUploadMinutes(storage, value) -> Promise<number>`.
- `createRecordingUploader` accepts `getUploadMinutes` and skips records below the threshold without calling `apiFn` or `signedPutFn`.

- [ ] Write failing tests for normalization, persistence, zero/unlimited behavior, positive duration gate, and short-record retention.
- [ ] Run focused tests and observe failure because the setting/gate is absent.
- [ ] Implement the smallest settings module and uploader gate.
- [ ] Run focused tests until green.

### Task 2: Authenticated settings UI

**Files:**
- Modify: `popup.html`, `popup.js`, `popup.css`
- Test: `tests/popup-dom.test.mjs`

- [ ] Add failing assertions for the exact label, numeric input, signed-in visibility, and save behavior.
- [ ] Run the focused DOM test and observe failure.
- [ ] Add the field to the existing signed-in settings area; load/save only when `getConnection` returns a token and show a clear saved/error state.
- [ ] Run the focused DOM test and syntax checks.

### Task 3: Full verification and issue close

- [ ] Run upload/settings/offscreen/backend/manifest tests and the full suite where the environment permits.
- [ ] Run `npm run validate` and `git diff --check`.
- [ ] Inspect `git status`, close Bead `meet-ext-u6`, and report any environment-limited tests.

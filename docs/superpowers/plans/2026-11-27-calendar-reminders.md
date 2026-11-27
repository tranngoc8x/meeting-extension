# Calendar Meeting Reminders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Notify signed-in users at a configurable 1–10 minute lead time (default 5) before scheduled Calendar meetings returned by the backend.

**Architecture:** The MV3 service worker owns a one-minute `chrome.alarms` poll. It calls the existing authenticated `/api/meetings` endpoint, deduplicates notifications in local storage, and uses Chrome notifications with an optional Meet URL click target.

**Tech Stack:** Chrome MV3 service worker, `chrome.alarms`, `chrome.notifications`, `chrome.storage.local`, existing Node ESM tests.

**Spec:** `docs/superpowers/specs/2026-11-27-calendar-reminders-design.md`

## Global Constraints

- Use the existing backend bearer token and fixed backend URL.
- Notify only `status: "scheduled"` meetings.
- Store `reminderMinutes` in `chrome.storage.sync`; do not change the backend settings contract.
- Preserve the commented bot dispatch flow.
- Do not add Google OAuth scopes in the extension.

## Review Focus

- Missing/expired login must skip polling without an unhandled rejection (test in background reminder module).
- Invalid or cancelled events must not notify (test event filtering).
- Repeated alarms must notify an event only once (test storage dedupe).
- A notification click must open the Meet room when `meetCode` is present (test click URL construction).
- Logout must stop polling and clear reminder state (test message handler).

### Task 1: Reminder scheduling and event filtering

**Files:**
- Create: `calendar-reminders.js`
- Test: `tests/calendar-reminders.test.mjs`

**Interfaces:**
- Produces `REMINDER_ALARM`, `syncCalendarReminders({ storage, apiFn, notifications, now })`, `clearCalendarReminders(storage, alarms)` and `meetingReminderId(meeting)`.

- [ ] Write failing tests for the five review-focus cases.
- [ ] Run `node --test tests/calendar-reminders.test.mjs` and verify the new tests fail for missing module behavior.
- [ ] Implement one-minute polling, configurable 1–10 minute notification window (default 5), storage dedupe, and cleanup.
- [ ] Re-run the focused test and then the full Node test suite.

### Task 2: Service-worker and manifest integration

**Files:**
- Modify: `manifest.json`
- Modify: `background.js`
- Modify: `tests/manifest.test.mjs`
- Modify: `tests/background-incall.test.mjs` or create `tests/background-reminders.test.mjs`

**Interfaces:**
- Consumes the reminder module from Task 1 and the existing `api` helper.

- [ ] Add `alarms` and `notifications` permissions and test them.
- [ ] Add the 1–10 minute reminder selector to the signed-in schedule card and persist it in sync storage.
- [ ] Register the alarm on startup/install and after `backend.connect`.
- [ ] Handle alarm ticks through the reminder module.
- [ ] Clear the alarm and reminder keys on `backend.disconnect`.
- [ ] Run focused and full tests, `node --check`, and `git diff --check`.

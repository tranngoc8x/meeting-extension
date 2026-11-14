# July Meeting Bot - Modern UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Overhaul the July Meeting Bot Chrome Extension UI from retro editorial style to a Modern Enterprise SaaS dashboard (Linear/Loom style) with zero regressions to existing functionality and full dark/light mode support.

**Architecture:** Restructure `popup.html` into modular cards with modern SVG icons while preserving all DOM IDs and data-binding contracts. Rewrite `popup.css` using modern design tokens (CSS variables, soft shadows, rounded corners, responsive micro-interactions, dark mode). Add automated DOM contract test in `tests/popup-dom.test.mjs` to safeguard elements against breakage.

**Tech Stack:** HTML5, CSS3 (Custom Properties, Flexbox/Grid, Dark Mode via `prefers-color-scheme`), Vanilla JavaScript (ES Modules, Chrome Extensions MV3), Node.js test runner (`node --test`).

---

### Task 1: Automated DOM Contract Test

**Files:**

- Create: `tests/popup-dom.test.mjs`
- Test: `tests/popup-dom.test.mjs`

- [ ] **Step 1: Write DOM Contract Test**

Create `tests/popup-dom.test.mjs` using Node.js built-in `node:test` and `node:assert/strict` that reads `popup.html` and verifies all DOM IDs, form elements, accessibility hooks, and required script tags exist.

```javascript
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(__dirname, "../popup.html"), "utf8");

test("popup.html contains all required functional DOM IDs for popup.js", () => {
  const requiredIds = [
    "conn-badge",
    "today",
    "conn-off",
    "connect",
    "backend-url",
    "conn-on",
    "avatar",
    "conn-email",
    "disconnect",
    "conn-state",
    "conn-error",
    "refresh",
    "state-dot",
    "state",
    "room",
    "bot",
    "schedule",
    "start",
    "end",
    "days",
    "schedule-status",
  ];

  for (const id of requiredIds) {
    const hasId = html.includes(`id="${id}"`) || html.includes(`id='${id}'`);
    assert.ok(hasId, `popup.html must contain element with id="${id}"`);
  }
});

test("popup.html includes stylesheet and popup.js module", () => {
  assert.ok(html.includes('href="popup.css"'), "Must link popup.css");
  assert.ok(html.includes('src="popup.js"'), "Must include popup.js");
  assert.ok(
    html.includes('type="module"'),
    "popup.js must be loaded as module",
  );
});

test("schedule form inputs have correct name attributes and required tags", () => {
  assert.ok(
    html.includes('name="start"'),
    'Start time input must have name="start"',
  );
  assert.ok(html.includes('name="end"'), 'End time input must have name="end"');
});
```

- [ ] **Step 2: Run test to verify it passes on current popup.html**

Run: `node --test tests/popup-dom.test.mjs`
Expected: PASS (3 tests pass)

---

### Task 2: Redesign `popup.html` Markup

**Files:**

- Modify: `popup.html`
- Test: `tests/popup-dom.test.mjs`

- [ ] **Step 1: Update `popup.html` with modern card-based semantic layout**

Update `popup.html` to replace the retro layout with a modern SaaS structure:

- Modern header with July logo icon + title + `#conn-badge` + `#today`.
- Card 1: Phòng họp (Hero Card) with Camera SVG icon, `#refresh` button with SVG, status dot (`#state-dot`), `#state`, `#room`, and `#bot`.
- Card 2: Tài khoản with Google SVG logo on `#connect` button, accordion for `#backend-url`, and connected profile block (`#conn-on`).
- Card 3: Lịch quét with Calendar/Clock SVG icon, time range inputs (`#start`, `#end`), `#days` container, and submit button.

```html
<!doctype html>
<html lang="vi">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>July Meeting Bot</title>
    <link rel="stylesheet" href="popup.css" />
  </head>
  <body>
    <div class="app-container">
      <!-- Header -->
      <header class="app-header">
        <div class="brand">
          <div class="brand-logo" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
              <path
                d="M12 2a2 2 0 0 1 2 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 0 1 7 7h1a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-1v1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1H2a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h1a7 7 0 0 1 7-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 0 1 2-2M7.5 13A2.5 2.5 0 0 0 5 15.5 2.5 2.5 0 0 0 7.5 18a2.5 2.5 0 0 0 2.5-2.5A2.5 2.5 0 0 0 7.5 13m9 0a2.5 2.5 0 0 0-2.5 2.5 2.5 2.5 0 0 0 2.5 2.5 2.5 2.5 0 0 0 2.5-2.5 2.5 2.5 0 0 0-2.5-2.5"
              />
            </svg>
          </div>
          <div class="brand-info">
            <h1 class="brand-name">July Meeting Bot</h1>
            <p id="today" class="dateline"></p>
          </div>
        </div>
        <span id="conn-badge" class="badge">…</span>
      </header>

      <main class="app-main">
        <!-- 01 Meeting Room (Hero Card) -->
        <section class="card hero-card" aria-labelledby="tab-title">
          <div class="card-header">
            <div class="card-title-group">
              <svg
                class="card-icon"
                viewBox="0 0 24 24"
                width="16"
                height="16"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <path
                  d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5"
                />
                <rect x="2" y="6" width="14" height="12" rx="3" />
              </svg>
              <h2 id="tab-title" class="card-title">Phòng họp</h2>
            </div>
            <button
              id="refresh"
              class="icon-btn"
              type="button"
              title="Làm mới trạng thái"
              aria-label="Làm mới"
            >
              <svg
                viewBox="0 0 24 24"
                width="15"
                height="15"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                <path d="M3 3v5h5" />
                <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
                <path d="M16 16h5v5" />
              </svg>
            </button>
          </div>
          <div class="meeting-box">
            <div class="meeting-status-row">
              <span id="state-dot" class="dot" aria-hidden="true"></span>
              <div class="meeting-details">
                <p
                  id="state"
                  class="meeting-state-text"
                  role="status"
                  aria-live="polite"
                >
                  Đang kiểm tra…
                </p>
                <p id="room" class="room-chip mono"></p>
              </div>
            </div>
            <p id="bot" class="pill" hidden></p>
          </div>
        </section>

        <!-- 02 Account Card -->
        <section class="card" aria-labelledby="conn-title">
          <div class="card-header">
            <div class="card-title-group">
              <svg
                class="card-icon"
                viewBox="0 0 24 24"
                width="16"
                height="16"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
              <h2 id="conn-title" class="card-title">Tài khoản</h2>
            </div>
          </div>

          <div id="conn-off" class="account-off">
            <p class="section-desc">
              Kết nối Google để bot tự động tham gia các cuộc họp trong lịch
              biểu.
            </p>
            <button
              id="connect"
              class="btn btn-primary btn-google"
              type="button"
            >
              <svg
                class="google-icon"
                viewBox="0 0 24 24"
                width="16"
                height="16"
                aria-hidden="true"
              >
                <path
                  fill="#4285F4"
                  d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
                />
                <path
                  fill="#34A853"
                  d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.33 24 12 24Z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.98 0 12s.45 3.82 1.25 5.42l4.03-3.15Z"
                />
                <path
                  fill="#EA4335"
                  d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98Z"
                />
              </svg>
              <span>Kết nối Google</span>
            </button>
            <details class="advanced">
              <summary>Cài đặt nâng cao</summary>
              <div class="advanced-body">
                <label class="field-label" for="backend-url"
                  >Địa chỉ backend</label
                >
                <input
                  id="backend-url"
                  class="input-text"
                  type="url"
                  placeholder="http://localhost:4000"
                  spellcheck="false"
                />
              </div>
            </details>
          </div>

          <div id="conn-on" class="account-on" hidden>
            <div class="user-profile">
              <span id="avatar" class="avatar" aria-hidden="true"></span>
              <div class="who">
                <span id="conn-email" class="email"></span>
                <span class="user-meta">Đang theo dõi lịch họp</span>
              </div>
            </div>
            <button id="disconnect" class="btn-disconnect" type="button">
              Ngắt kết nối
            </button>
          </div>

          <p
            id="conn-state"
            class="sr-only"
            role="status"
            aria-live="polite"
          ></p>
          <p id="conn-error" class="error-banner" role="alert"></p>
        </section>

        <!-- 03 Schedule Form Card -->
        <form id="schedule" class="card" aria-labelledby="schedule-title">
          <div class="card-header">
            <div class="card-title-group">
              <svg
                class="card-icon"
                viewBox="0 0 24 24"
                width="16"
                height="16"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              <h2 id="schedule-title" class="card-title">Lịch quét tự động</h2>
            </div>
            <span class="cadence-tag">Mỗi 10 phút</span>
          </div>

          <div class="times-grid">
            <div class="time-field">
              <label class="field-label" for="start">Bắt đầu</label>
              <input
                id="start"
                class="time-input"
                name="start"
                type="time"
                required
              />
            </div>
            <span class="time-separator" aria-hidden="true">→</span>
            <div class="time-field">
              <label class="field-label" for="end">Kết thúc</label>
              <input
                id="end"
                class="time-input"
                name="end"
                type="time"
                required
              />
            </div>
          </div>

          <div class="days-container">
            <p class="field-label">Ngày trong tuần</p>
            <fieldset id="days" class="days-group">
              <legend class="sr-only">Ngày trong tuần</legend>
            </fieldset>
          </div>

          <div class="card-footer">
            <span
              id="schedule-status"
              class="schedule-status"
              role="status"
              aria-live="polite"
            ></span>
            <button class="btn btn-save" type="submit">
              <span>Lưu thay đổi</span>
            </button>
          </div>
        </form>
      </main>
    </div>
    <script type="module" src="popup.js"></script>
  </body>
</html>
```

- [ ] **Step 2: Run DOM contract test**

Run: `node --test tests/popup-dom.test.mjs`
Expected: PASS

---

### Task 3: Implement Modern Enterprise CSS in `popup.css`

**Files:**

- Modify: `popup.css`
- Test: `node --test tests/*.test.mjs`

- [ ] **Step 1: Write modern CSS rules**

Rewrite `popup.css` with:

- Modern CSS custom properties for Light and Dark modes.
- Sleek typography, card elevations, borders, and shadows.
- Beautiful button designs (Google sign-in button, Primary save button with hover states).
- Polished weekday toggle pills (`.days-group`, `.day`, `.day input:checked + span`).
- Glowing live meeting status dot (`#state-dot.live` pulse animation).
- Semantic badges (`#conn-badge.ok`, `#bot.pill.ok`, `.pill.warn`, `.pill.danger`).
- Smooth focus states for full accessibility.

- [ ] **Step 2: Run all tests to ensure zero regressions**

Run: `npm test`
Expected: All 14 tests pass (13 existing + 1 DOM contract).

---

### Task 4: Visual Polish & Verification

**Files:**

- Modify: `popup.css` (if any micro-adjustments needed)
- Test: `npm test`

- [ ] **Step 1: Verify layout spacing, contrast, and edge cases**
- [ ] **Step 2: Verify light and dark mode appearance**
- [ ] **Step 3: Run entire test suite**

Run: `npm test`
Expected: PASS

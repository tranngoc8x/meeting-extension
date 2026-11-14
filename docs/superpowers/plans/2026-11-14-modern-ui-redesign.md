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

- Modern header with UrBox logo icon + title + `#conn-badge` + `#today`.
- Card 1: Phòng họp (Hero Card) with Camera SVG icon, `#refresh` button with SVG, status dot (`#state-dot`), `#state`, `#room`, and `#bot`.
- Card 2: Tài khoản with Google SVG logo on `#connect` button, accordion for `#backend-url`, and connected profile block (`#conn-on`).
- Card 3: Lịch quét with Calendar/Clock SVG icon, time range inputs (`#start`, `#end`), `#days` container, and submit button.

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

# July Meeting Bot - Modern UI Redesign Spec

- **Date**: 2026-11-14
- **Topic**: Modern Enterprise SaaS UI Redesign for Chrome Extension Popup
- **Status**: Approved by User

---

## 1. Executive Summary & Goals

The July Meeting Bot Chrome extension currently uses a retro editorial/newspaper aesthetic (cream paper background `#f1ede4`, serif typography `Iowan Old Style`, numbered raw sections, hairline borders). While distinctive, the user requested a significantly more professional, modern look.

This design overhauls the extension popup into a **Modern Enterprise SaaS** aesthetic (inspired by Linear, Loom, and Notion):

- Crisp typography using modern system sans-serif font stack (`-apple-system`, `BlinkMacSystemFont`, `Inter`, `Segoe UI`).
- Modular **Card-based Dashboard** architecture (`border-radius: 12px`, subtle border `#E2E8F0`, soft shadow).
- Full **Light & Dark mode** support with automatic detection via `prefers-color-scheme`.
- Refined micro-interactions: pulse live-dot indicator during meetings, smooth icon rotations, polished weekday pill toggles.
- **100% zero-regression compatibility**: All DOM IDs, input names, class bindings, and event handlers used by `popup.js` and tests remain strictly preserved.

---

## 2. Visual Architecture & Design System Tokens

### 2.1 Typography

- **Primary Font Stack**: `-apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, Helvetica, Arial, sans-serif`
- **Monospace Stack** (for room code & backend URL): `"SF Mono", ui-monospace, "Cascadia Code", Menlo, monospace`
- **Scale**:
  - App Title: `14px`, `font-weight: 600`, tracking `tight`
  - Section Headings: `12px`, `font-weight: 600`, uppercase, tracking `0.05em`
  - Body Text / Status: `13px`, `font-weight: 500`, line-height `1.4`
  - Small / Meta / Dateline: `11px`, `font-weight: 500`, tracking `normal`
  - Time inputs: `18px`, `font-weight: 600`, tabular figures

### 2.2 Color Palette (Tokens)

| Token Name         | Light Theme             | Dark Theme           | Purpose                                |
| :----------------- | :---------------------- | :------------------- | :------------------------------------- |
| `--bg-app`         | `#F8FAFC` (Slate 50)    | `#0B0F19`            | Extension popup container background   |
| `--bg-card`        | `#FFFFFF`               | `#111827` (Gray 900) | Modular card surfaces                  |
| `--bg-subtle`      | `#F1F5F9` (Slate 100)   | `#1F2937` (Gray 800) | Input background, hover states         |
| `--border-color`   | `#E2E8F0` (Slate 200)   | `#1F2937` (Gray 800) | Card borders, dividers                 |
| `--border-focus`   | `#E11D48`               | `#F43F5E`            | Accessible focus ring / active state   |
| `--text-primary`   | `#0F172A` (Slate 900)   | `#F9FAFB` (Gray 50)  | Main titles, labels, input values      |
| `--text-secondary` | `#475569` (Slate 600)   | `#9CA3AF` (Gray 400) | Supporting descriptions, timestamps    |
| `--text-muted`     | `#94A3B8` (Slate 400)   | `#6B7280` (Gray 500) | Inactive pills, placeholders           |
| `--accent-red`     | `#E11D48` (July Rose)   | `#F43F5E`            | July logo badge, live recording mark   |
| `--status-ok`      | `#10B981` (Emerald 500) | `#34D399`            | Connected badge, live meeting, success |
| `--status-warn`    | `#F59E0B` (Amber 500)   | `#FBBF24`            | Bot queued status                      |
| `--status-danger`  | `#EF4444` (Red 500)     | `#F87171`            | Disconnected, errors                   |

### 2.3 Geometry & Layout

- Width: `375px` (standard comfortable popup width).
- Padding: `16px` overall popup body padding.
- Card Border Radius: `12px` with `border: 1px solid var(--border-color)`.
- Input & Button Border Radius: `8px`.
- Status & Tag Radius: `9999px` (pill).
- Shadow: `0 1px 3px 0 rgba(0, 0, 0, 0.05), 0 1px 2px -1px rgba(0, 0, 0, 0.05)`.

---

## 3. Component Details & Interactivity

### 3.1 Header (Masthead)

- **Wordmark**: July branded icon (subtle red rounded square with robot/meeting camera motif or recording indicator) + text "July Meeting Bot".
- **Connection Badge (`#conn-badge`)**: Pill badge on the right displaying "Đã kết nối" (green tinted pill with border) or "Chưa kết nối" (muted gray pill).
- **Dateline (`#today`)**: Clean subtitle with calendar icon and localized Vietnamese date format.

### 3.2 Meeting Room Card (`.sec` - Phòng họp)

- **Header**: Icon (Video camera SVG) + title "Phòng họp" + refresh icon button (`#refresh`) aligned right with smooth hover transition.
- **Meeting State Row**:
  - Live dot indicator (`#state-dot`): Pulses with an emerald/rose glowing aura when `live` is active.
  - Meeting Status Text (`#state`): E.g., "Đang trong cuộc họp", "Chưa vào cuộc họp", "Mở tab Google Meet...".
  - Room Code (`#room`): Displayed as a clean monospace badge with background chip if present.
- **Bot Status Pill (`#bot`)**: Semantic badge (`.pill.ok`, `.pill.warn`, `.pill.danger`) with status text like "Đã gửi bot vào phòng", cleanly styled with soft background tint and matching text.

### 3.3 Google Account Card (`.sec` - Tài khoản)

- **Disconnected State (`#conn-off`)**:
  - Description: "Kết nối Google để bot tự động vào các cuộc họp trong lịch."
  - Primary Button (`#connect`): Sleek button with Google SVG icon ("G" logo) and text "Kết nối Google".
  - Advanced Settings (`details.advanced`): Clean accordion with subtle arrow indicator.
  - Backend URL input (`#backend-url`): Clean bordered text input with subtle placeholder.
- **Connected State (`#conn-on`)**:
  - Avatar Monogram (`#avatar`): Circular avatar with gradient/accent background and user initial.
  - User Info (`.who`): User email (`#conn-email`) with bold title and subtitle "Đang theo dõi lịch họp".
  - Disconnect Button (`#disconnect`): Subtle text button with destructive red hover state.
- **Feedback Alerts**: `#conn-error` styled as a dismissible/alert box in red tint when non-empty.

### 3.4 Scan Schedule Card (`#schedule` - Lịch quét)

- **Header**: Clock icon + title "Lịch quét" + subtitle pill "mỗi 10 phút".
- **Time Inputs (`.times`)**:
  - Two input fields: "Bắt đầu" (`#start`) and "Kết thúc" (`#end`).
  - Inputs feature comfortable padding, rounded borders, clean custom clock picker styling.
- **Weekday Selector (`#days`)**:
  - Monday to Sunday (`T2` through `CN`) rendered as a connected or segmented pill group.
  - Each day is a clickable pill with smooth background/color transition when checked. Checked state uses solid brand/primary color.
- **Actions Bar**:
  - Status indicator (`#schedule-status`): Displays "Đã lưu và đồng bộ" or error.
  - Submit Button: Primary action button "Lưu thay đổi" with clean arrow or check icon.

---

## 4. Technical Feasibility & Compatibility

1. **DOM ID Preservations**:
   - `#backend-url`, `#connect`, `#disconnect`, `#conn-off`, `#conn-on`, `#conn-email`, `#avatar`, `#conn-badge`, `#conn-state`, `#conn-error`
   - `#refresh`, `#state`, `#state-dot`, `#room`, `#bot`
   - `#schedule`, `#start`, `#end`, `#days`, `#schedule-status`
   - `#today`
2. **Behavioral Compatibility**:
   - `popup.js` creates `<label class="day"><input type="checkbox" name="day" value="${day}" aria-label="${label}"><span>${label}</span></label>` dynamically inside `#days`. The CSS must support this exact markup.
   - `BOT_STATUS` injects class names like `pill ok`, `pill warn`, `pill danger` to `#bot`.
   - `#state-dot` toggles class `live`.
   - `#conn-badge` toggles class `ok`.
   - `#schedule-status` toggles classes `ok` and `bad`.
3. **Tests Compatibility**:
   - Run `npm test` to verify all 13 test suites pass before and after changes.

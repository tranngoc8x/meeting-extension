# Calendar Meeting Reminders Design

## Intent

Sau khi đăng nhập, extension nhắc user bằng Chrome notification trước 5 phút cho các meeting lấy từ backend Calendar API.

## Goals

- Gọi `GET /api/meetings` bằng backend bearer token hiện có.
- Chỉ nhắc meeting có `status: "scheduled"` và `startAt` hợp lệ.
- Hiện một notification duy nhất cho mỗi `meeting.id` tại mốc nhắc do user chọn, mặc định 5 phút và giới hạn 1–10 phút.
- Notification có thể mở tab Google Meet khi event có `meetCode`.

## Non-goals

- Không gọi bot vào họp; logic bot vẫn được comment.
- Không xin thêm Google OAuth scope trong extension.
- Không dùng Web Push server; dùng Chrome service worker alarm + polling.

## Approach

Service worker tạo `chrome.alarms` chạy mỗi phút khi extension khởi động hoặc user đăng nhập. Mỗi lần chạy gọi `/api/meetings`, chọn các event trong cửa sổ gần mốc `startAt - reminderMinutes`, rồi ghi khóa `calendar-reminder:<id>` vào `chrome.storage.local` trước khi tạo notification để chống báo trùng. `reminderMinutes` được lưu trong `chrome.storage.sync` với giá trị hợp lệ 1–10 và mặc định 5. Dữ liệu đã báo được dọn khi đăng xuất.

Manifest thêm `alarms` và `notifications`. Khi đăng xuất, alarm và các khóa reminder được xóa.

## Constraints

- Contract backend: `{ meetings: [{ id, title, meetCode, startAt, status }] }`.
- Backend URL cố định `https://api.july.io.vn`.
- Polling không được làm gián đoạn ghi âm cục bộ.

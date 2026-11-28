# Configurable Recording Upload Duration

## Intent

Cho phép người dùng đã đăng nhập cấu hình thời lượng tối thiểu trước khi bản ghi được gửi lên server. Nhãn UI chính xác là **“Gửi bản ghi với các cuộc họp có độ dài xx phút”**. Giá trị `0` nghĩa là không giới hạn: mọi bản ghi hoàn tất đều được upload; mặc định giữ ngưỡng hiện tại là 3 phút.

## Goals

- Lưu ngưỡng trong `chrome.storage.sync`.
- Chỉ hiển thị và cho lưu cấu hình khi extension đã đăng nhập.
- Gate upload ở service worker ngay trước chuỗi API/R2.
- Giữ nguyên bản ghi ngắn trên máy để người dùng tải xuống hoặc upload lại sau khi đổi ngưỡng.
- Không thay đổi contract backend hoặc signed R2 flow.

## Non-goals

- Không xóa bản ghi ngắn.
- Không thay đổi thời lượng ghi âm.
- Không thêm endpoint backend.
- Không coi bản ghi chưa đăng nhập là đủ điều kiện upload chỉ vì đạt ngưỡng.

## Approaches

- Cài đặt trong popup/options hiện có: ít thay đổi, cùng vùng với trạng thái tài khoản; được chọn.
- Trang upload riêng: dễ mở rộng nhưng tạo thêm luồng UI không cần thiết.
- Cấu hình backend: tập trung nhưng sai phạm vi vì đây là tuỳ chọn theo extension/user.

## Behavior

- Input số phút nhận số nguyên từ `0` trở lên; giá trị rỗng, âm hoặc không hợp lệ dùng `0`.
- Thời lượng tính từ `startedAt` đến `endedAt`, làm tròn xuống theo phút để so với ngưỡng.
- Nếu chưa có token, không chạy upload và không cho lưu thay đổi cấu hình từ UI.
- Nếu bản ghi ngắn hơn ngưỡng, giữ `pending-upload` và đánh dấu local là bị bỏ qua theo cấu hình, không gọi API.

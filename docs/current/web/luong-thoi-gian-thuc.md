# Luồng thời gian thực `/me/stream` của workspace-web

Nguồn: fix-msg-web (gộp 2026-11-12). Code: `W/platform/stream/me-stream.ts`. Sự kiện tin nhắn: [pack-contracts/tin-nhan.md](../pack-contracts/tin-nhan.md) mục 3.

#### Yêu cầu: Một kết nối mỗi tab, tự nối lại, báo để tải lại phần đã lỡ
Khi kết nối dừng do 4xx rồi người nghe mới mở lại, mọi người nghe cũ được báo «đã nối lại» để tải lại dữ liệu đã lỡ.
- Kịch bản: dừng do 403 rồi người nghe mới mở lại ⇒ người nghe cũ nhận một lần báo nối lại [test: apps/workspace-web/src/platform/stream/me-stream.test.ts » dừng do 4xx rồi người nghe mới mở lại]

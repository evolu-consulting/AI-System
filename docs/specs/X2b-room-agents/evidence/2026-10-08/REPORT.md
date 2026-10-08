# UAT X2b-room-agents — 2026-10-08

Người chạy: agent `qc-uat` (Sonnet), commit evidence `50c159f`, code tại `e06a235` (`done:x2b` xanh 13/13).
Báo cáo do điều phối ghi lại từ bàn giao qc-uat (công cụ Write của agent bị chặn).

## Stack
- `hub:dev` với `HUB_DEV_RUNTIME=none`, chat-web dev :3100, **runtime giả** `scripts/rt-server.ts` :4058 — mọi câu trả lời agent do script trả. Không Dify thật, không `claude-sub` (đang `logged_out`).
- Chromium, `locale: vi-VN`; 3 context desktop (A julian.bui — hoadon + trello; B thomas.tran — trello; C vio.ngo — hoadon) + 1 context 390px.
- Script: `scripts/run.mjs`, `scripts/rt-server.ts`; kết quả máy: `result.json`; 41 ảnh trong thư mục này.

## Kết quả: 16/17 đạt, #14 đúng spec (xem dưới), #10 lỗi hiển thị

| # | Kịch bản (`manual-test-I2.md`) | Kết quả | Ghi chú |
|---|---|---|---|
| 1–2 | Menu `@` đúng quyền (A 2 agent, B 1) | Đạt | Tài liệu kiểm tay ghi có `orchestrator` trong menu — lệch tài liệu, spec R14/e2e chỉ liệt kê `GET /agents` |
| 3–9 | Gọi agent, "đang xử lý…" → khối "Julian Bui hỏi", huy hiệu +2, Dừng → "Đã huỷ", B/C sai quyền bị từ chối và giữ chữ, 2 khối song song không lẫn, thread chung | Đạt | |
| 10 | `need_input`: chỉ A có chip; B thấy "Đang chờ Julian Bui trả lời agent." | Đạt, **lỗi hiển thị** | Câu hỏi hiện lặp 2 lần (thân tin + khung hỏi) — `10-B-waiting.png`, `10-A-chip.png` |
| 11–13 | `side_effect` chỉ A có nút, DOM B không có chi tiết; thu hồi quyền từ chối ngay (~0,4 s); F5 giữ khối đang xử lý | Đạt | |
| 14 | Người gọi rời nhóm khi run đang chạy | Run bị huỷ; người ở lại không thấy khối "Đã huỷ" | **Đúng spec** X2b-R17/Q8 ("huỷ run, không ghi tin vào phòng") — không phải lỗi. Ảnh `14-A-after-leave-*.png` |
| 15–17 | Điện thoại 390px (sheet "Flow đang mở"), các ca còn lại | Đạt | |

## Lỗi script đã sửa trong lúc chạy
- `@orchestrator` cần job trả JSON `decision` → thêm `/rt/decide` vào runtime giả.
- Menu 390px chụp lúc đang tải → chờ ổn định rồi chụp. Đã chạy lại toàn bộ sau khi sửa.

## Chưa kiểm
- #14 biến thể "bị bớt" và "chủ xoá nhóm" (đã có int `lifecycle.int`).
- Trần 20 run đồng thời của hub:dev; trình duyệt ngoài Chromium; agent thật (chờ `claude-sub` đăng nhập lại).

## Dọn
Đã tắt server trên :4000, :3001, :3100, :4058; Docker (Postgres, Redis, Mailpit) vẫn chạy; đã dọn `%TEMP%/rss-*`.

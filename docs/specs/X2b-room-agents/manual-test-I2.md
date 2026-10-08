# X2b · I2 — Hướng dẫn kiểm tay `@agent` trong phòng

Dành cho **người dùng**. Phạm vi: spec [`spec.md`](spec.md) §2, §5, AC ở §8. Lệnh chạy ở gốc repo `D:\AI\ai-system`. Bật hệ thống y như [X2a manual-test-I2](../X2a-rooms/manual-test-I2.md) §1 (`docker compose up -d --wait`, `bun run hub:dev`, chat-web `:3100` với `HUB_URL`/`AUTH_URL`). Migrate 0014–0016 và agent mẫu do `hub:dev` tự tạo (idempotent).

**Lưu ý agent thật:** `claude-sub` đang `logged_out` nên agent không trả lời thật; muốn thấy câu trả lời cần Runtime/provider giả hoặc đăng nhập `claude-sub`. Không có thì chỉ kiểm được phần quyền, menu `@`, trạng thái lỗi/huỷ (đánh dấu "bỏ qua" ở bước cần trả lời).

## 1. Tài khoản (tenant `evolu`, mật khẩu `1234567890`)
| Cửa sổ | Người | Agent dùng được |
|---|---|---|
| A (thường) | `julian.bui` | `hoadon`, `trello` |
| B (ẩn danh) | `thomas.tran` | `trello` |
| C (ẩn danh khác) | `vio.ngo` | `hoadon` |

Phòng: nhóm "Evolu team" (cả 5 người) và DM Julian–Thomas.

## 2. Kịch bản
| # | Làm gì | Kỳ vọng |
|---|---|---|
| 1 | A mở "Evolu team", gõ `@` | Menu liệt kê `orchestrator`, `hoadon`, `trello` (tên + `@key` + mô tả); không panel/chip agent |
| 2 | B gõ `@` trong cùng nhóm | Chỉ thấy `orchestrator`, `trello` (không `hoadon`) |
| 3 | A gửi `@hoadon tổng hợp hoá đơn tháng này` | Mọi người thấy tin của A và khối agent "đang xử lý"; B, C xem được cả khối kết quả |
| 4 | Khi chạy, A bấm "Dừng" | Khối thành "Đã huỷ" cho mọi người |
| 5 | B gõ tay `@hoadon …` (không có quyền) | Bị từ chối kiểu "không tìm thấy agent"; nội dung giữ trong ô soạn, không tạo run |
| 6 | C gửi `@hoadon …` | Chạy bằng quyền của C; khối ghi "chạy bằng quyền của Vio" |
| 7 | A và C gọi agent gần nhau | Hai khối chạy song song, không lẫn |
| 8 | A bấm mở thread của khối agent | Thread chung: B, C cũng có composer; tin không tag là người↔người |
| 9 | Trong thread, B gõ `@trello …` | Run của **B** (quyền B); trả lời hiện trong thread; A xem được |
| 10 | Agent hỏi lại (`need_input`/`side_effect`) ở run của A | A thấy nút trả lời/xác nhận; B, C chỉ thấy "chờ A trả lời"; B thử xác nhận ⇒ bị chặn |
| 11 | Với `side_effect`, nội dung chi tiết | Chỉ A thấy bản chi tiết; B, C thấy bản công khai |
| 12 | A gửi `@orchestrator tóm tắt` | Orchestrator chạy; tên người gửi tin = "Orchestrator" nếu không có agent cụ thể |
| 13 | A gửi tin có đính kèm file trong phòng | Không có nút đính kèm (X2b-2 mới làm) |
| 14 | Chạy dở, A rời nhóm / bị bớt / chủ xoá nhóm | Run của người đó bị huỷ; (xoá nhóm: mọi run phòng) |
| 15 | Đổi quyền: thu hồi `hoadon` của C (Admin), C gọi lại | Bị từ chối ngay, không chờ làm tươi cache |
| 16 | F5 trong lúc run | Khối "đang xử lý" còn nguyên; kết quả hiện khi xong; tin không mất/lặp |
| 17 | Hỏi AI (mục riêng) | Hội thoại C1 vẫn như cũ; không lẫn tin phòng vào danh sách hội thoại |

## 3. Ghi kết quả
Ghi vào [`spec-decisions.md`](spec-decisions.md) mục **C. Kết quả kiểm tay I2** (thêm mục nếu chưa có), mỗi dòng `YYYY-MM-DD [tên] bước <n> — Đạt/Lỗi: <mô tả> — mức (Chặn/Cao/Thường)`; một dòng "bước 1–17 đạt trừ …" là đủ. Lỗi kèm tài khoản, trình duyệt, giờ. Lỗi Chặn/Cao sửa trước X2b-2; còn lại vào `docs/TECH-DEBT.md`.

## 4. Dừng / dọn
`Ctrl+C` các terminal; `docker compose down` nếu muốn tắt hạ tầng. Dữ liệu giữ trong DB `ai_system`.

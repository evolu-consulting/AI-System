# X2a · Quyết định trong lúc làm + kết quả kiểm tay I2

Tách từ `spec.md` §10 (giữ spec ≤ 25 KB). Quy tắc: mỗi lần tự quyết theo Luật 2 thêm một dòng.

## A. Quyết định trong lúc làm
- 2026-10-07 [docs-architect, readiness R1, Luật 2b] Stub mock Hub (`tools/mocks/src/*`) cho `/rooms`, `/directory`, `/me/stream` ở mức tối thiểu để e2e C1 xanh, không phải mở rộng realtime (Q7, task B3); `hub.create_room` kiểm `is_tenant_user` (plan-db §4.2); tên FE theo contract BE (`parseMeStreamEvent`, `last_activity_at`, `preview`, `owner_id`+`members[]`); 400 = `VALIDATION_ERROR`; `pingMs` trong deps `startHub` (mặc định 15000); QC1 chỉ khoá `tests/acceptance/X2a/**` + `e2e/chat/x2a-*`, contract `x2a-*` là lưới phụ; token giao diện DataZeus (nếu áp) thuộc mốc UI riêng, không chặn X2a, e2e X2a không khẳng định màu/ảnh chụp.
- 2026-10-07 [frontend-lead, PLAN P2] Q5 "Đã xem" DM/nhóm dưới tin cuối của mình; Q9 `/rooms/$id`; mở DM qua ô tìm sidebar mục "Người"; mobile giữ Sheet danh sách C1; Composer phòng thêm prop `menus`/`attachments`; `shell.newChat` → "Hỏi AI"; ngưỡng JS chat có thể nới 150 → 160 KB (chi tiết `plan-frontend.md` §0, §14).
- 2026-10-07 [backend-lead, PLAN P1] Tự quyết D1–D16 → `plan.md` §1 (đổi so với spec: 400 = `VALIDATION_ERROR` (spec cũ ghi mã khác); bỏ `rooms.owner_id`; `member_ids`/`user_ids` ≤ 200, > 50 ⇒ `ROOM_FULL`; thêm `client_msg_id`, `last_seq`, `preview`).
- 2026-10-07 [backend-lead, B1] `create_room`: kind lạ/peer sai ⇒ 22023; `dm_key` so uuid (không theo collation).
- 2026-10-07 [backend-lead, B2] `DirectoryQuerySchema` non-strict (khoá lạ bỏ qua); query/`RoomList`/`MessageList` strict; `RoomFullDetails.requested` ≥ 0.

## B. Kết quả kiểm tay I2 (người dùng)
Hướng dẫn: [`manual-test-I2.md`](manual-test-I2.md). Ghi mỗi lỗi/ý kiến một dòng: `YYYY-MM-DD [người] bước <n> — kết quả — mức (Chặn/Cao/Thường)`.

- 2026-10-08 [điều phối, thay người dùng, Playwright 2 trình duyệt] bước 01–14 — đạt 14/14; evidence [`evidence/2026-10-08/REPORT.md`](evidence/2026-10-08/REPORT.md) — lỗi seed `EMAIL_REQUIRED` (demo evolu) đã sửa — Cao
- (người dùng tự kiểm: chưa)

---
id: tool-knownred-fix
lát: tool-knownred-fix
cr:
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Sửa `intReds`: log `bun test` kết thúc bằng khối "N tests failed:" lặp lại các `(fail)` KHÔNG kèm tiêu đề file, nên trước đây gán nhầm vào file cuối (seed-community-demo) ⇒ đỏ cũ (migrate-hub, chat-gate) thành "đỏ MỚI".

## Làm
- `intReds`: ca gắn file đúng chỗ ca chạy (kể cả `(unnamed)` của hook); khối tóm tắt chỉ bổ sung ca KHÔNG xuất hiện inline (không file).
- `matchesEntry`: khớp (file, tên); đỏ không có file ⇒ dự phòng khớp theo tên ca của id.
- Fixture `__fixtures__/int-recap.log` trích từ log evotest thật (int 2026-11-03, 4 đỏ).

## Không làm / Chạm
Chỉ `known-red.rules.ts` + test. Không thêm hub-rls vào known-red (đỏ mới thật, chờ xác minh trên base).

## Test tối thiểu
`known-red.recap.test.ts` (fixture thật), `known-red.test.ts`.

## Quyết định trong lúc làm
Dùng log text (có tiêu đề file) thay vì junit: junit có `file` mỗi ca nhưng không có chuỗi mô tả lồng nhau khớp khuôn id; log inline đã đúng file.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)

Không thay đổi hành vi (lý do: công cụ dev, sửa lỗi gán file của quarantine)

## Việc còn lại
- `hub-rls` (`packages/db/src/hub-rls.int.test.ts` RLS 5 bảng hội thoại) đỏ thật chưa có trong known-red: cần chạy trên base rồi sửa hoặc ghi.

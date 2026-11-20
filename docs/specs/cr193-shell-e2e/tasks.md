---
id: cr193-shell-e2e
lát: cr193-shell-e2e
cr: CR-193
làn: nhanh
migration: không
phụ thuộc: cr193-shell
---
## Plan (ngắn)
Phân tích 2 ca đỏ lượt e2e 20261120-084112: N1 `shell.n1.ts` (tuyến cũ chuyển hướng) và root-1 `m4-audit.spec.ts` («Tải thêm»).

## Làm
- [x] Xác định nguyên nhân (không đổi code).

## Không làm / Chạm
Không chạm code; N1 là test đã khoá (chỉ qc sửa).

## Test tối thiểu
Không chạy e2e.

## Quyết định trong lúc làm
- N1: không do chính sách cuộn. `/settings` ⇒ `/contracts/settings` ⇒ `/contracts/org` do CR-189 (`routes/_authed/contracts/settings/index.tsx`, commit bbb7c8b78: «Thành viên & phòng ban» mở tab Sơ đồ trước). Test còn kỳ vọng `/contracts/settings/members` ⇒ test cũ, cần qc đổi kỳ vọng thành `/contracts/org` (shell.n1.ts:107).
- root-1: không do chính sách cuộn. «Tải thêm» không điều hướng (không đổi đường dẫn) nên `scrollRestoration` trả false/không chạm; chính sách chỉ gắn thuộc tính `data-scroll-restoration-id` + hai tuỳ chọn router. Snapshot lỗi: nút «Tải thêm» vẫn còn, 50 dòng ⇒ `fetchNextPage` không thêm dòng (phía dữ liệu/API). Ca này đã từng chập chờn (ba8ad6488, CR-161). Đề nghị chạy lại riêng ca này; đỏ lại ⇒ xem request trang 2 của /audit trong trace.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: lát chỉ chẩn đoán).

## Việc còn lại
qc cập nhật kỳ vọng N1; chạy lại m4-audit riêng.

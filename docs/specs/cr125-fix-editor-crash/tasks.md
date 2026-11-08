---
id: cr125-fix-editor-crash
lát: cr125-fix-editor-crash
cr: CR-125
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Trình xem Thư viện (tenant_admin, `?company=`) sập "reading 'map'": `GET process-library/:id` trả stage THÔ biên dịch từ khe (slot + trigger), thiếu `sources`/`must_know`; `stageToDraft` gọi `.map` trên undefined.

## Làm
- `lib/stage-convert.ts`: `sources`/`must_know` vắng ⇒ rỗng (helper `rawListsToDraft`).
- `lib/library-flow.test.ts`: test tái hiện (stage thật thiếu trường) — đỏ trước, xanh sau.
- `e2e/P-a/pf4/admin-editor.pa.ts`: tên node "Giai đoạn 1" -> "Bước 1" (nhãn đã đổi).

## Không làm / Chạm
process-library.pa.ts (tab "Mẫu · chạy thử" đã gỡ) giữ ở known-red.

## Test tối thiểu
unit library-flow; e2e P-a một lần.

## Quyết định trong lúc làm
Sửa ở `stageToDraft` (điểm chung mọi nơi đọc stage thô) thay vì chỉ ở `libraryFlowOf`.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-docs-sync)

Không thay đổi hành vi (lý do: sửa sập trang xem Thư viện do stage thô thiếu trường mặc định; hành vi hiển thị đã mô tả sẵn)

## Việc còn lại
Gộp sau khi P-a xanh.
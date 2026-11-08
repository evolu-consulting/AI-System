---
id: qc-pa-rewrite
lát: qc-pa-rewrite
cr: CR-125
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Viết lại hai spec P-a lỗi thời theo UI hiện tại, giữ ý gốc: admin-editor (đổi người duyệt ⇒ Lưu ⇒ xung đột ⇒ mẫu chỉ xem) và process-library (thư viện: dùng mẫu, nháp, xoá).

## Làm
- admin-editor.pa.ts: «Nhóm kiểm» ⇒ «Phòng ban duyệt»; nút Lưu; mẫu «Dùng mẫu này».
- process-library.pa.ts: gợi ý nháp «công ty nào», nút Xuất bản vN.
- Gỡ hai mục khỏi tests/known-red.json.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: cập nhật test theo UI đã đổi)

## Việc còn lại
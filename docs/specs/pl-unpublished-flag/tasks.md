---
id: pl-unpublished-flag
lát: pl-unpublished-flag
cr: CR-105
làn: nhanh
migration: không
phụ thuộc: pl-ux-simplify
---
## Plan (ngắn)
Cờ `has_unpublished_changes` cho def thư viện (danh sách + chi tiết): đã có bản xuất bản mà nháp (stages / slot_body / tên) khác bản đó. Tính trong cùng câu SQL của danh sách/đọc (subquery theo PK `process_def_releases(def_id, rel_version)`, không truy vấn từng dòng). Contract: `process-library.ts`. admin-web: trạng thái "Có thay đổi chưa xuất bản (vN)" ở danh sách + thanh trên editor.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp
Không thay đổi hành vi (lý do: cờ hiển thị CR-105)

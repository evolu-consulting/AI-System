---
id: cr125-scenes-title
lát: cr125-scenes-title
cr:
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Nguyên nhân: 766124523 (CR-125 c7) bỏ suy tên từ fields.title ở web, dùng thẳng `c.title` của hub (hub đã trả contractNameSql). Mock e2e trả `title` = tên file ⇒ tiêu đề lộ slug. Sửa mock.

## Làm

## Không làm / Chạm

## Test tối thiểu

## Quyết định trong lúc làm

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: chỉ sửa mock e2e `contractAsHub()` cho đúng hình hub sau CR-125 c7 — `title` = tên HĐ do contractNameSql tính, không phải tên file; sản phẩm đã đúng).

## Việc còn lại

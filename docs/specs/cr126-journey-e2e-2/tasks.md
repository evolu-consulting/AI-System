---
id: cr126-journey-e2e-2
lát: cr126-journey-e2e-2
cr: CR-126
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Phần 3 bước 10: sau «Gửi» form kế tiếp hiện ngay ⇒ spec chờ API gửi phiếu OK thay vì chờ form biến mất.

## Làm
- cr125-purchase-full.spec.ts submitOpenForm.

## Không làm / Chạm
Chỉ e2e.

## Test tối thiểu
evotest journey-purchase xanh.

## Quyết định trong lúc làm
Nguyên nhân là test (không phải lỗi sản phẩm).

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-09 (đợt cr126-wave)

Không thay đổi hành vi (lý do: e2e hành trình)

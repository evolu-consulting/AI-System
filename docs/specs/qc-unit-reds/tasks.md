---
id: qc-unit-reds
lát: qc-unit-reds
cr:
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Quét 22 đỏ unit trên gd0: sửa test/fixture cũ, ghi lỗi sản phẩm bên dưới.

## Làm
Xem commit: sửa test cũ (known-red, e2e configs, i18n bị gỡ, schema đổi, mailer qua Hub, sniff office/gif/webp, snapshot chat C1 cộng thêm, mock record_label).

## Không làm / Chạm

## Test tối thiểu

## Quyết định trong lúc làm
- FB1-AC-09: cho phép riêng ops/tls.check.ts dùng rejectUnauthorized:false (chỉ đọc hạn chứng chỉ, không gửi dữ liệu).

## Lỗi sản phẩm
- check-contract-name (CR-121 Q-4): partner-send.repo.ts:37 và partner-ui.repo.ts:47 đọc c.title thô thay vì contractNameSql ⇒ tên HĐ sai ở gửi đối tác / hộp thư; nghi lát CR-125 partner-send / partner-ui.
- theme-parity (PK-FR-10): token sáng + sidebar (và tối: secondary/accent/sidebar...) lệch admin-web (tím #6e56f0) vs contracts trong workspace-web (indigo #4f46e5); nghi lát CR-121 admin palette / workspace-web hợp nhất; cần chốt bên nào là chuẩn rồi đồng bộ CSS hoặc cập nhật DARK_DRIFT/LIGHT_DRIFT.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr124-cr125)

Không thay đổi hành vi (lý do: chỉ sửa test/fixture/mock cũ; lỗi sản phẩm ghi ở mục Lỗi sản phẩm)

## Việc còn lại

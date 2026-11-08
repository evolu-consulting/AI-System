---
id: cr120-pm-flowpane
slice: cr120-pm-flowpane
cr: CR-120
lane: nhanh
migration: không
phụ thuộc: cr120-settings-layout
---
## Plan (ngắn)
Sửa e2e pm-checklist: user có cả gói Community nên menu tài khoản có hai mục bắt đầu bằng "Cài đặt" ("Cài đặt chung" của Community đứng trước).

## Làm
`e2e/pm-checklist/cw-cr113.pm.ts` chọn mục menu "Cài đặt" khớp CHÍNH XÁC (Cài đặt Sổ Hợp Tác) thay vì `.first()`.

## Không làm / Chạm
Không đổi sản phẩm: FlowCurrentPane vẫn tải đúng; hộp thoại bị mở nhầm là Cài đặt chung của Community (một khung, cùng tên "Cài đặt").

## Test tối thiểu
e2e pm-checklist-pm.

## Quyết định trong lúc làm
Test cũ nhắm `.first()` khi menu chỉ có một mục Cài đặt; từ CR-120 one-shell menu có thêm "Cài đặt chung" ⇒ sửa test, không sửa sản phẩm.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)

Không thay đổi hành vi (lý do: chỉ sửa bộ chọn của e2e pm-checklist sau khi menu có thêm mục "Cài đặt chung" của Community).
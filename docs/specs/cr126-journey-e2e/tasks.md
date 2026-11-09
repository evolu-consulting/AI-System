---
id: cr126-journey-e2e
lát: cr126-journey-e2e
cr: CR-126
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Hành trình duyệt: (1) `_test.ts` đóng mọi context ca tự mở; (2) `cr125-purchase-full` làm cả dòng HĐ (duyệt / ký thử) của hộp MỘT.

## Làm
- `e2e/journey-approval/_test.ts` (fixture tự động đóng context) + đổi import `test` ở mọi spec.
- `cr125-purchase-full.spec.ts`: `actOnContractRows` (approval-task-row → Duyệt/Đạt; signing-task-row → Ký ngay / Ký thử).

## Không làm / Chạm
Chỉ e2e/journey-approval.

## Test tối thiểu
Chạy evotest e2e journey-approval + journey-purchase một lần.

## Quyết định trong lúc làm
Không ca nào chia trang giữa các ca ⇒ đóng context theo từng ca an toàn.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-09 (đợt cr126-wave)

Không thay đổi hành vi (lý do: e2e hành trình)
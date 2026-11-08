---
id: cr121-f17-library-steps-cell
lát: cr121-f17-library-steps-cell
cr: CR-121
làn: nhanh
migration: không
phụ thuộc: c15, F14
---
## Plan (ngắn)
UAT lượt 3: hàng "Nhận hợp đồng (mặc định)" ở Thư viện hiện số trơn "7" ở cột Các bước (khe không có tên bước trong slot_body), khác các hàng chip.

## Làm
`lib/step-chips.ts` `stepsDisplay` (chip | count | none); `StepChips` thêm `count` ⇒ viên trung tính "N bước" cùng kiểu chip; `StepsCell` dùng nó. i18n `process.admin.library.stepsCount` (vi/en). Công ty › Quy trình (`JobRow`) không có số bước khi chưa tải tên bước (chỉ có `steps`), nên chưa cùng trường hợp — giữ nguyên.

## Test
unit `lib/step-chips.test.ts » CR-121 f17`. Không sửa e2e. Perf: không chạm.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)

### ADDED admin/thu-vien-cot-cac-buoc.md
#### Yêu cầu: Cột Các bước của Thư viện một kiểu hiển thị (CR-121 UAT)
Cột Các bước hiện chip tên bước; khi quy trình không có tên bước thì hiện viên trung tính "N bước" cùng kiểu chip, không bao giờ số trơn.
- Kịch bản: có tên ⇒ chip, không tên ⇒ viên đếm, không có ⇒ trống [test: apps/admin-web/src/features/processes/lib/step-chips.test.ts » CR-121 f17 · cột Các bước một kiểu]
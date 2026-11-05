---
id: cr121-r3-features-spec
lát: cr121-r3-features-spec
cr: CR-121
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
root-6 đỏ mới: features.spec.ts › CR-055 · M2-AC04 (tab Commands). Kẹt ở bước thêm lại /kiemtra-hoadon (dòng 156): ô chọn không còn mục đó vì nháp đã có lại hàng /kiemtra-hoadon (và /tom-tat hai lần) sau lưu lần 2.

## Làm
- (c, nghi chập chờn đua tải lại) Không liên quan i18n common.list / DetailDrawer (W1) hay ListPage: trang editor Feature không dùng chúng, mã editor không đổi trong đợt. Nghi bản tải lại feature (invalidate sau PATCH) về muộn đè nháp vừa sửa. Test chờ `networkidle` sau mỗi lần lưu rồi mới sửa tiếp; không nới assert.

## Không làm / Chạm
Chỉ `e2e/features.spec.ts`. Không đổi mã sản phẩm.

## Test tối thiểu
`run-tests.ps1 -Step e2e -Filter root` (mảnh root-6 không chọn riêng được).

## Quyết định trong lúc làm
Chưa chứng minh được nguyên nhân gốc (không có trace); nếu còn đỏ sau chờ networkidle thì là lỗi sản phẩm đua `reset` form/feature trong `use-feature-conflict.ts` cần lát riêng.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: chỉ thêm bước chờ đồng bộ trong e2e features.spec.ts)

## Việc còn lại

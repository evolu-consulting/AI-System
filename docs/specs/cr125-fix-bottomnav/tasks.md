---
id: cr125-fix-bottomnav
lát: cr125-fix-bottomnav
cr: CR-125
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Thanh dưới 375 px bị «Tạo yêu cầu» đẩy mất «Bảng tin». Thêm cờ `mobile: 'primary'|'more'` cho mục nav + hàm thuần `pickBottomItems`.

## Làm
- `shell/bottom-nav.ts` (`pickBottomItems`): primary đứng trước, `more`/`bottom:false` loại, cắt theo số cột.
- Cờ: Hợp đồng + Bảng tin = primary; Tạo yêu cầu = more. `BottomNav.tsx` dùng hàm mới.

## Không làm / Chạm
Không đổi menu trái / desktop. Không có menu "Thêm" riêng trên điện thoại: «Tạo yêu cầu» vào qua menu trái/thẻ Tổng quan.

## Test tối thiểu
`shell/bottom-nav.test.ts` (unit); e2e community-web shell.cm.ts chạy một lần bằng evotest.

## Quyết định trong lúc làm
Dùng lại `bottom?: false` có sẵn, thêm `mobile` thay vì sửa `.slice`.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)

### ADDED sht/thanh-duoi-dien-thoai.md
#### Yêu cầu: Thanh dưới điện thoại ưu tiên Hợp đồng và Bảng tin
Thanh dưới 375 px xếp mục `primary` (Hợp đồng, Bảng tin) trước, rồi các mục còn lại; mục `more` (Tạo yêu cầu) không chiếm cột.
- Kịch bản: khi người dùng có cả hai gói thì thanh dưới có Hợp đồng và Bảng tin, không có Tạo yêu cầu [test: apps/workspace-web/src/shell/bottom-nav.test.ts » có gói Sổ Hợp Tác: 4 mục gồm Hợp đồng + Bảng tin, không có Tạo yêu cầu]

## Việc còn lại

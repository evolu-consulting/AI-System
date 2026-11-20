---
id: cr193-shell-fix2
lát: cr193-shell-fix2
cr: CR-193
làn: nhanh
migration: không
phụ thuộc: cr193-shell-fix
---
## Plan (ngắn)
e2e cr193-scroll vẫn đỏ ở bước chuẩn bị: đệm 4000px chèn vào khung `board` (cột flex, `flex-shrink:1`) bị co về 0 ⇒ không có gì để cuộn.

## Làm
- [x] e2e: đệm đặt `flex:none`.

## Không làm / Chạm
Chỉ `e2e/contracts-web/cr193-scroll.cw.ts`; code không sai.

## Test tối thiểu
Không chạy e2e (điều phối chạy).

## Quyết định trong lúc làm
- Phần tử vùng cuộn và hàm `top()` đúng; lỗi do đệm bị co.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: chỉ sửa dữ liệu dựng của e2e).

## Việc còn lại
Chạy lại e2e cr193-scroll.

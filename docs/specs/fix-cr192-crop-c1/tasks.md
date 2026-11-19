---
id: fix-cr192-crop-c1
lát: fix-cr192-crop-c1
cr: CR-192
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
C1 đỏ lượt 3: `page.waitForLoadState("networkidle")` quá 45 s (không phải lệch toạ độ).

## Làm
- [x] `cr192-crop.cs.ts`: bỏ `networkidle`; thay bằng `settled()` chờ khung bao avatar/bìa y hệt qua 3 lần đo.

## Không làm / Chạm
Không đổi code sản phẩm. Chạm: `e2e/community-web/cr192-crop.cs.ts`, `tests/.lock`.

## Test tối thiểu
Không chạy e2e (điều phối chạy).

## Quyết định trong lúc làm
- Gốc: app giữ kết nối mở liên tục ⇒ trình duyệt không bao giờ «idle»; lỗi ở cách đo, không phải bố cục. Các phép so x/y/kích thước sau đó giữ nguyên (chưa thấy lệch nào ở lượt này vì test dừng trước đó).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: chỉ sửa cách chờ của test e2e).

## Việc còn lại
Điều phối chạy lại C1; nếu còn đỏ ở phép so toạ độ thì đọc error-context lượt đó.

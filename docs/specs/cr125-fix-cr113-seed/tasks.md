---
id: cr125-fix-cr113-seed
lát: cr125-fix-cr113-seed
cr: CR-125
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Stack pm-checklist-pm chết ở `seed-cr113: duyệt thay HĐ 2 → 403 NOT_REVIEWER` — đỏ cả ở base c950033d8 lẫn gd0 HEAD (không do S2).

## Làm
Nguyên nhân: cr125-seed (2f57d4a21) bật cờ `flow_triggers` + gán flow mặc định cho evolu ⇒ "Mở lại" chạy flow theo sự kiện, nơi không có `also_group_ids`
(Toàn quyền duyệt thay chỉ do khe duyệt HĐ biên dịch ra) ⇒ chủ gói không duyệt thay được. Sửa SEED (`e2e/pm-checklist/_pm-stack.ts`): tắt cờ cho evolu trước khi gieo mẫu CR-113
(mẫu kiểm đúng đường khe). `cw-cr113` ca 1 cập nhật theo S2 (Cài đặt hiện flow Bật "Duyệt 2 cấp").

## Không làm / Chạm
Sản phẩm: flow theo sự kiện chưa có "Toàn quyền duyệt thay" (khoảng trống chức năng, ghi cho điều phối).

## Test tối thiểu
evotest -Step e2e -Filter pm-checklist-pm -Dirty: 13 pass.

## Quyết định trong lúc làm
Sửa phía seed (giả định cũ), không đổi sản phẩm.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp
Không thay đổi hành vi (lý do: chỉ sửa fixture/test e2e pm-checklist, không đổi code sản phẩm)

## Việc còn lại
Quyết định có cần "Toàn quyền duyệt thay" cho flow theo sự kiện hay không.
---
id: fix-cr191-grant
lát: fix-cr191-grant
cr: CR-191
làn: nhanh
migration: sửa tại chỗ hub 0168 + 0170, pack-contracts 0129 (chưa áp ở máy chủ bền nào)
phụ thuộc: cr191-partner-connect
---
## Plan (ngắn)
GRANT hàm `hub.cc_*` cho `contracts_rw` phải đúng với MỌI thứ tự hub/gói/role trên cụm sạch.

## Làm
- [x] hub 0168/0170: điều kiện role bằng `to_regrole('contracts_rw')` (khuôn chung), ghi chú vì sao cấp lại ở gói.
- [x] pack-contracts 0129: GRANT chuyển thành khối `DO` cấp từng hàm chỉ khi `to_regnamespace('hub')` và `to_regprocedure(...)` có; thêm `hub.cc_listing()` và `hub.cc_set_listed(boolean, uuid)` (hub 0170) mà trước đây KHÔNG ai cấp cho `contracts_rw` khi hub chạy trước role gói.

## Không làm / Chạm
Không đổi hành vi, journal, chữ ký hàm.

## Test tối thiểu
Evotest int: `connect.routes.int.test.ts` (20 xanh, DB dựng lại vì băm migration đổi), `community-cr191-audience.int.test.ts`; `migrate-hub.int.test.ts` đỏ sẵn 2 ca do bảng `process_role_assignments` (CR-182) chưa vào `HUB_TABLES`, không liên quan.

## Quyết định trong lúc làm
- Không tái hiện được lỗi GRANT gốc trong int (cụm evotest đã có role gói) nên sửa theo thứ tự có thể sai; lỗi thật tìm thấy: hai hàm hub 0170 không được cấp cho `contracts_rw` trên cụm sạch.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: sửa migration cấp quyền cho đúng thứ tự dựng DB sạch, chưa áp ở máy chủ bền).

## Việc còn lại
- Chưa tái hiện được lỗi gốc ở dựng DB từ đầu; cần log lỗi của điều phối để xác nhận.

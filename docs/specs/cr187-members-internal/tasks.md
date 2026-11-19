---
id: cr187-members-internal
lát: cr187-members-internal
cr: CR-187
làn: đầy đủ
migration: không
phụ thuộc: —
---
## Plan (ngắn)
BR-187-2: danh sách Thành viên và cơ cấu (`/admin/org`, `/admin/org/members`) chỉ người nội bộ (`kind='internal'`); mọi ô chọn thành viên/phòng/quản lý đều đọc hai API này nên theo cùng nguồn.

## Làm
- [x] `org.service.ts` `getOrg` + `listOrgMembers`: thêm `kind = 'internal'` (số câu SQL không đổi; `total` đổi theo).
- [x] int test đỏ trước rồi xanh: `org.service.int.test.ts` (ca người ngoài; quản trị khác người tạo dữ liệu, N2).
- [x] e2e viết, CHƯA chạy: `e2e/journey-approval/cr187-members.spec.ts` (cần `CR187_PARTNER_NAME`).

## Không làm / Chạm
- Không đổi giao diện trang Thành viên (CR-189), không giới hạn cấp quản lý (CR-189). Không xoá dữ liệu cũ. Không migration.

## Test tối thiểu
- int `apps/admin-api/src/modules/org/org.service.int.test.ts`.

## Quyết định trong lúc làm
- Gán người ngoài làm quản lý / được quản lý / trưởng phòng đã trả 422 `EXTERNAL_USER_NOT_ALLOWED` (dịch lỗi trigger 0028/0029 ở `setManager`, `setDepartment`; `external-deny.int.test.ts` đã khoá qua HTTP) ⇒ chỉ thêm int test mức service, không thêm câu SQL kiểm trước.
- Web (workspace OrgPage/PersonPick, admin-web org api) không đổi: chúng chỉ đọc hai API trên.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED org/nghiep-vu.md
#### Yêu cầu: Thành viên và phòng ban chỉ người nội bộ (CR-187)
Danh sách thành viên, tổng số và mọi ô chọn thành viên/phòng/quản lý chỉ gồm người nội bộ công ty; tài khoản đối tác không hiện. Gán đối tác làm quản lý/trưởng phòng bị từ chối rõ nghĩa (422).
- Kịch bản: khi quản trị xem cơ cấu hoặc danh sách thành viên thì không có người đối tác, tổng số không tính họ [test: apps/admin-api/src/modules/org/org.service.int.test.ts » CR-187 · BR-187-2 · thành viên và cơ cấu chỉ người nội bộ > listOrgMembers: người ngoài không có trong trang, không tính vào tổng, tìm theo tên cũng không ra]
- Kịch bản: khi một quản trị khác người tạo dữ liệu mở cơ cấu thì cũng không thấy đối tác [test: apps/admin-api/src/modules/org/org.service.int.test.ts » CR-187 · BR-187-2 · thành viên và cơ cấu chỉ người nội bộ > getOrg: người ngoài không có trong danh sách thành viên (quản trị khác người tạo vẫn thấy đúng)]
- Kịch bản: khi gán đối tác làm quản lý hoặc trưởng phòng thì báo 422 và không ghi gì [test: apps/admin-api/src/modules/org/org.service.int.test.ts » CR-187 · BR-187-2 · thành viên và cơ cấu chỉ người nội bộ > gán người ngoài làm quản lý / được quản lý / trưởng phòng ⇒ 422 EXTERNAL_USER_NOT_ALLOWED, không ghi]
- Kịch bản: khi quản trị mở trang Thành viên thật thì không thấy đối tác [test: e2e/journey-approval/cr187-members.spec.ts » quản trị thấy danh sách thành viên không có đối tác]

## Việc còn lại
- Điều phối chạy e2e cuối đợt (cần seed một người đối tác ở `demo`, đặt `CR187_PARTNER_NAME`).

---
id: fix-cr189-delete-500
lát: fix-cr189-delete-500
cr: CR-189
làn: nhanh
migration: không
phụ thuộc: cr189-admin-org-api
---
## Plan (ngắn)
Xoá phòng trả 500 ở môi trường chỉ-admin (test/dev): DB có Hub GIẢ (`migrations-dev/0000_hub_stub.sql`: chỉ `agent_grants`, không có hàm `hub.org_group_refs`) nên kiểm fail-closed `hub_refs_unavailable` tưởng là lỗi triển khai. Gốc: `orgRefsState` coi «có `agent_grants`» là Hub thật. Sửa: Hub thật = có `hub.review_tasks`; Hub giả ⇒ trạng thái `stub` đếm agent trực tiếp từ `agent_grants`.

## Làm
- [x] `org.hub.ts`: trạng thái `stub` (agent_grants, không review_tasks) — đếm agent cấp cho nhóm; `broken` chỉ khi Hub thật mà hàm vắng/chưa cấp (giữ fail-closed). Không đổi migration hub 0172.
- [x] int: ca xoá phòng ở môi trường Hub giả (rỗng ⇒ 204, còn agent ⇒ 204 nhưng giữ Group).

## Không làm / Chạm
Không migration (0172 đã giao, không sửa tại chỗ). Chạm: `apps/admin-api/src/modules/org/org.hub.ts`, `org-dept.routes.int.test.ts`.

## Test tối thiểu
int (evotest): `org-dept.routes.int.test.ts`, `org-dept.hub.int.test.ts`, `org-dept.service.int.test.ts` (38 pass).

## Quyết định trong lúc làm
- Phân biệt Hub thật/giả bằng sự có mặt của `hub.review_tasks` (bảng chỉ có ở Hub thật); không dựa vào `agent_grants` (có ở cả hai).
- Hub giả vẫn kiểm agent theo nhóm (admin_rw có SELECT) để không xoá Group còn cấp agent; quy trình/việc duyệt không tồn tại ở Hub giả.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED docs/current/admin/to-chuc-xoa-phong-hub-gia.md
#### Yêu cầu: Xoá phòng chạy được khi chỉ có Hub giả
Môi trường chỉ-admin (Hub giả) không báo lỗi triển khai khi xoá phòng; Hub thật mà hàm tham chiếu không gọi được vẫn báo lỗi và không xoá.
- Kịch bản: khi DB chỉ có Hub giả thì xoá phòng rỗng trả 204, phòng còn agent theo nhóm trả 204 nhưng Group giữ [test: apps/admin-api/src/modules/org/org-dept.routes.int.test.ts » DB chỉ có Hub giả (môi trường chỉ-admin): xoá phòng rỗng ⇒ 204 (không 500), phòng còn agent theo nhóm ⇒ 204 nhưng Group giữ]
- Kịch bản: khi Hub thật mà hàm hub.org_group_refs không cấp cho admin_rw thì xoá phòng báo lỗi và Group còn nguyên [test: apps/admin-api/src/modules/org/org-dept.hub.int.test.ts » có bảng Hub nhưng hàm hub.org_group_refs không cấp cho admin_rw ⇒ xoá phòng báo lỗi, KHÔNG xoá Group, phòng còn nguyên]

## Việc còn lại
Không.

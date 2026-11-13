---
id: org-tree
lát: org-tree
cr: CR-139d
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
«Sơ đồ tổ chức nên là sơ đồ cây, chỉnh được ở admin.» Cột `admin.departments.parent_group_id` đã có (migration 0015) nhưng chưa API nào đặt.
Admin-api `PUT /admin/org/departments/:id` nhận thêm `parent_group_id` (chặn vòng, chuỗi cha quá 32 tầng ⇒ `dept_too_deep`, chặn cha ngoài công ty; audit `before` có phòng cha cũ); admin-web thêm mục con «Cơ cấu» ở Thành viên;
Sổ Hợp Tác `/contracts/org` vẫn chỉ xem, thêm «Xem thành viên» + nút «Chỉnh sơ đồ» (SSO sang admin).

## Làm
- [x] contracts `org.ts`: `parent_group_id` trong phòng ban + request (bỏ qua = giữ).
- [x] `org.service.ts`: đổi cha (khoá theo công ty, CTE leo cha ⇒ `dept_cycle`, cha phải là phòng ban cùng công ty), gỡ phòng ⇒ con lên cha của nó.
- [x] admin-web `features/org`: cây chỉnh được (thêm/đổi tên/xoá, «Thuộc phòng», trưởng phòng, thành viên); mục con `view=org`.
- [x] workspace-web: mở/ẩn thành viên, nút «Chỉnh sơ đồ» (`org-editor-link.ts`).

## Không làm / Chạm
Không kéo-thả, không migration. Thẻ phòng ban cũ ở workspace-web `/settings/members` đã gỡ (G2), thay bằng một dòng + «Chỉnh sơ đồ»; e2e `org-visibility` dựng phòng ban ở backend giả.

## Test tối thiểu
unit `org-edit.test.ts`, `org-editor-link.test.ts`; int `org.service.int.test.ts` (đường chính, vòng, chéo công ty); e2e `cr139d-org-tree.spec.ts` (viết, chưa chạy).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED sht/so-do-to-chuc.md
#### Yêu cầu: Sơ đồ tổ chức dạng cây
Sổ Hợp Tác hiện cây Công ty → phòng → phòng con (tên phòng, trưởng phòng, số người; mở ra xem thành viên); mọi nhân viên nội bộ chỉ xem.
- Kịch bản: khi nhân viên mở Sơ đồ tổ chức thì thấy cây phòng ban, mở được thành viên và không có nút «Chỉnh sơ đồ» [test: e2e/journey-approval/cr139d-org-tree.spec.ts » nhân viên xem cây]; [test: apps/workspace-web/src/features/org-chart/lib/org-tree.test.ts]
- Kịch bản: khi quản trị công ty bấm «Chỉnh sơ đồ» thì sang màn Cơ cấu ở admin [test: apps/workspace-web/src/features/org-chart/lib/org-editor-link.test.ts]

#### Yêu cầu: Chỉnh cơ cấu ở admin
Quản trị công ty thêm/đổi tên/xoá phòng, chọn «Thuộc phòng», đặt trưởng phòng, thêm/bớt thành viên; có audit.
- Kịch bản: khi đặt phòng cha thì cây đổi, bỏ qua phòng cha thì giữ nguyên, gỡ phòng giữa thì phòng con lên cha của nó [test: apps/admin-api/src/modules/org/org.service.int.test.ts » đặt cha, giữ nguyên khi bỏ qua]
- Kịch bản: khi chọn phòng cha là chính nó hoặc phòng con của nó thì bị chặn (dept_cycle) và danh sách «Thuộc phòng» không hiện các phòng đó [test: apps/admin-api/src/modules/org/org.service.int.test.ts » vòng cha–con]; [test: apps/admin-web/src/features/org/lib/org-edit.test.ts » chọn «Thuộc phòng»]
- Kịch bản: khi phòng cha thuộc công ty khác hoặc chưa là phòng ban thì không tìm thấy [test: apps/admin-api/src/modules/org/org.service.int.test.ts » cha ở công ty khác]

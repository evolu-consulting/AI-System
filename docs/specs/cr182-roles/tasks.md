---
id: cr182-roles
lát: cr182-roles
cr: CR-182
làn: nhanh
migration: hub 0159
phụ thuộc:
---
## Plan (ngắn)
Quy trình ghi `role` (Duyệt, nhóm cùng duyệt, chuyển cấp) và `signer_role` (Ký). Quản trị công ty giao NHÓM hoặc MỘT NGƯỜI cho vai (`hub.process_role_assignments`).
Giải vai bằng `withRoles` (thuần) tại các điểm R2; lượt đang chạy giữ ảnh chụp cũ.

## Làm
- [x] Zod tuỳ chọn: `role` (review / parallel.groups[] / escalate), `signer_role` + `need_digital` (Ký).
- [x] Migration hub 0159 (bảng, RLS đọc theo tenant, hàm `hub.role_assign` đòi `app.company_admin`, audit `role_assigned`).
- [x] `withRoles` + repo `processes/roles/roles.repo.ts`; gắn ở start.service, subprocess-def, flow-preview, flow-outline, stagesFor (đường nháp), màn xem.
- [x] API: `GET /approval-flow` thêm `graph[].role/assigned`; `PUT /approval-flow/roles` (chỉ quản trị công ty, audit trước/sau).

## Không làm / Chạm
Không làm: trình soạn admin (cr182-admin), màn giao việc (cr182-assign), migration điền vai từ cấu hình cũ + chuông «chưa giao người» (cr182-migrate).
Chạm: contracts (`hub-admin/process-*`, `pack-contracts/esign-node|approval-flow`, `flow/with-roles`), db (0159, journal, audit actions), hub-api (processes/roles, runs, library, packs/contracts).

## Test tối thiểu
unit `with-roles.test.ts`, `esign-node.test.ts`; int evotest `roles.int.test.ts`, `approval-flow-roles.int.test.ts` (route PUT), `approval-flow-current.int.test.ts` (19 xanh).

## Quyết định trong lúc làm
- Cờ ghi quản trị đặt tên chung `app.company_admin` (không dùng `sig_admin`); hàm tái dùng `hub.sig_ctx()`.
- Audit: action `role_assigned`, entity `process_def` (entity_id = flow), before/after = `{role_key, group_id, user_id}`.
- Giao việc theo (tenant, flow_id = process_defs.id, role_key); nhánh «cùng duyệt» chỉ nhận NHÓM (giao người ⇒ coi là chưa giao).
- Vai chưa giao khi MỞ LƯỢT từ sự kiện: từ chối mở (AppError `ROLE_UNASSIGNED` ⇒ `FlowLaunchRefused group_missing:<khoá vai>` ⇒ lý do có sẵn `FLOW_GROUP_MISSING:<khoá vai>`, HĐ dừng chờ + «Mở lại»). Chuông cho quản trị công ty thuộc cr182-migrate. Chuyển cấp chưa giao ⇒ `escalate=null` (mặc định Toàn quyền), không chặn.
- BR-G2 theo R2: ảnh chụp giữ `role`; giải vai lúc bắt đầu lượt (chặn sớm) VÀ giải lại KHI MỞ bước (`refreshStageRoles` ở `launcher-plan.plan`, `team-runner.openReview`, `gates.effects.openReview`; có giao thì ghi đè `group_id`/`approver_user_id`/`company_signers` của bản chụp, vai bỏ giao thì giữ giá trị cũ). Bước đang chờ (đã mở) không qua đây ⇒ giữ người cũ.
- Người/nhóm được giao mà hết hợp lệ (người bị khoá/vô hiệu, nhóm bị xoá) ⇒ `loadRoleAssignments` và cột `assignments` của `eventFlows` bỏ ⇒ coi như chưa giao.
- Vai chặn chưa giao ⇒ từ chối MỌI đường mở lượt (tay, từ sự kiện, `!key`): 422 `ROLE_UNASSIGNED` kèm tên vai.
- `PUT` kiểm `role_key` có trong stages của quy trình (422 `ROLE_KEY_UNKNOWN`); cờ `app.company_admin` do `assignRoleAudited` đặt sau khi kiểm `isAdmin` (bắt buộc) và gỡ ngay.
- Journal: 0159 `when` = 1806903300000 (sau 0158 của cr184).
- `need_digital` để `optional` (vắng = false) để không đổi kết quả decode def cũ; `esignConfigIssues`: có `signer_role` thì không đòi `company_signers`.
- `eventFlows` thêm cột `assignments` trong CÙNG câu SQL (không thêm round-trip).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED engine/quy-trinh-cr127.md
#### Yêu cầu: Giao việc theo vai cho bước Duyệt và bước Ký
Bước Duyệt (kể cả nhóm cùng duyệt, chuyển cấp) và bước Ký ghi vai; quản trị công ty giao nhóm hoặc một người cho vai, một vai nhiều bước giao một lần. Lúc bắt đầu lượt, vai được đổi thành người làm trong ảnh chụp; vai chưa giao thì lượt mở từ sự kiện không mở được và dừng chờ.
- Kịch bản: khi quản trị giao nhóm cho vai thì lượt mới của quy trình có nhóm đó ở bước Duyệt [test: apps/hub-api/src/modules/processes/roles/roles.int.test.ts » giao nhóm ⇒ lượt mới có group_id của nhóm, vai Ký chưa giao ⇒ unassigned chặn]
- Kịch bản: khi đổi giao việc thì ảnh chụp đã lấy giữ người cũ còn lượt mới dùng người mới [test: apps/hub-api/src/modules/processes/roles/roles.int.test.ts » BR-G2: đổi giao việc ⇒ ảnh chụp đã lấy giữ người cũ, lượt MỚI dùng người mới, bỏ giao ⇒ vai trống + chặn]
- Kịch bản: khi người thường ghi giao việc thì bị từ chối [test: apps/hub-api/src/modules/processes/roles/roles.int.test.ts » người thường gọi thẳng hub.role_assign (không cờ quản trị công ty) ⇒ 42501, không ghi gì]
- Kịch bản: khi công ty khác đọc giao việc thì không thấy [test: apps/hub-api/src/modules/processes/roles/roles.int.test.ts » công ty khác KHÔNG đọc giao việc của công ty A]
- Kịch bản: khi giao việc thì ghi nhật ký trước và sau [test: apps/hub-api/src/modules/processes/roles/roles.int.test.ts » quản trị giao NHÓM ⇒ ghi + audit role_assigned trước rỗng và sau nhóm, cả hai đích hay nhóm công ty khác ⇒ 22023]
- Kịch bản: khi quản trị gói Sổ Hợp Tác không phải tenant admin ghi giao việc thì được còn người thường bị 403 [test: apps/hub-api/src/modules/packs/contracts/adapters/approval-flow-roles.int.test.ts » quản trị gói Sổ Hợp Tác (vai member, KHÔNG phải tenant admin) PUT ⇒ 200, nhóm kèm thành viên, audit role_assigned]
- Kịch bản: khi đổi giao việc của vai bước sau thì bước đó mở ra cho người mới còn bước đã mở giữ người cũ [test: apps/hub-api/src/modules/processes/roles/roles.int.test.ts » BR-G2: lượt đang ở bước 1, đổi giao việc vai bước 2 ⇒ bước 2 mở ra cho người mới, bước 1 (đã mở) giữ người cũ, vai bỏ giao ⇒ giữ giá trị cũ]
- Kịch bản: khi vai chặn chưa giao thì không mở được lượt [test: apps/hub-api/src/modules/processes/roles/roles.int.test.ts » lượt mở (tay hay từ sự kiện) mà còn vai chặn chưa giao ⇒ từ chối 422 kèm tên vai]
- Kịch bản: khi người được giao bị khoá thì coi như chưa giao [test: apps/hub-api/src/modules/processes/roles/roles.int.test.ts » người được giao bị khoá sau khi giao ⇒ coi như chưa giao]
- Kịch bản: khi tính ra người làm từ vai thì đúng cho duyệt, cùng duyệt, chuyển cấp, ký [test: packages/contracts/src/flow/with-roles.test.ts » review: giao nhóm ⇒ group_id, giao người ⇒ approver_user_id, bỏ mã cũ]

## Việc còn lại
- Chưa có int chạy engine đầy đủ (kick lượt thật rồi thẻ duyệt cho người mới): `refreshStageRoles` test trên bản chụp của một run seed, các điểm gọi (`plan`, hai `openReview`) chỉ ghép; cr182-qc nên phủ bằng e2e.
- Bước Ký: làm mới `company_signers` ở `plan` (trước khi chạy tool); chưa test riêng đường tool Ký.
- Lỗi có sẵn ngoài phạm vi: `pmsg-db.int.test.ts:412` tsc, `form.rules.test.ts:107` đỏ.

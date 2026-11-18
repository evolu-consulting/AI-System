---
id: cr182-polish
lát: cr182-polish
cr: CR-182
làn: nhanh
migration: không
phụ thuộc: cr182-roles, cr182-assign, cr182-admin
---
## Plan (ngắn)
Gom chỗ dở các lát trước báo lại: quyền sửa giao việc do server quyết (`can_edit`), thành viên nhóm hiện ngay khi chọn nhóm (API mới, tải dần), vai chỉ-nhóm khoá «Một người», màn xem bước Ký theo vai, trình soạn Ký nhập vai mới (`signer_role_label`).

## Làm
- [x] `GET /pack/contracts/approval-flow` thêm `can_edit` (= `companyAdminCheck`, cùng luật PUT /roles: tenant admin ∨ admin gói Sổ Hợp Tác); web `FlowDetail` dùng `flow.canEdit` thay `isCompanyAdmin`.
- [x] `GET /pack/contracts/groups/:id/members?offset&limit` (quyền đọc gói, chỉ nhóm của công ty mình, 30/trang, `next`); `FlowAssignMembers` hiện thành viên (avatar + chức vụ qua `/people?ids=`) ngay khi chọn nhóm + «Xem thêm».
- [x] `graph[].role.group_only` (vai dùng ở nhánh «cùng duyệt» của bất kỳ bước nào) ⇒ UI khoá «Một người» kèm lý do.
- [x] `graph[].need_digital`; màn xem: bước Ký có vai ⇒ huy hiệu «Ký trên tài liệu» / «Cần chữ ký số», dòng «Người ký: <vai>» + người được giao (danh sách: «Người ký: <vai> · <người>»); def cũ chưa có vai giữ «Ký qua» cũ.
- [x] Chuông «Chưa giao người» (`role-unassigned-bell.ts`) gửi cả người có quyền `admin` gói Sổ Hợp Tác (trực tiếp hoặc qua nhóm), không chỉ tenant admin.
- [x] Tách `buildSigners` + `CompanySigner` khỏi `sign-doc.usecase.ts` sang `sign-doc-signers.ts` (401 ⇒ 353 dòng, không đổi hành vi; re-export giữ nguyên import).
- [x] `esign-node`: `signer_role_label` tuỳ chọn (encode/decode); `withRoles` + graph dùng nhãn này; trình soạn admin dùng `RoleField` (chọn vai có sẵn hoặc nhập vai mới).

## Không làm / Chạm
Không làm: hiện vai ở bước «cùng duyệt» không có vai chính trên sơ đồ (graph chỉ mang một vai mỗi bước).
Chạm: contracts (approval-flow, approval-flow-roles, esign-node, flow/with-roles), hub-api packs/contracts (routes, usecase, graph rules, mount), kit/pack-groups, workspace-web settings, admin-web esign Panel, i18n v2l.

## Test tối thiểu
unit: `event-flow-graph.rules.test.ts`, `esign-node.test.ts`, `with-roles.test.ts`, `flow-view.test.ts`; int evotest: `approval-flow-roles.int.test.ts`, `approval-flow-current.int.test.ts`.

## Quyết định trong lúc làm
- `can_edit` nằm ở GỐC thân `{items, can_edit}` (không theo từng flow); web gắn vào mỗi `CurrentFlow.canEdit`.
- Thành viên nhóm: API chỉ trả `{id, name}` + `next`; avatar/chức vụ dùng lại `GET /people?ids=` (một lần mỗi trang) thay vì nhân đôi dữ liệu.
- `group_only` tính theo cả quy trình (khoá vai xuất hiện ở bất kỳ nhóm «cùng duyệt» nào), vì giải vai chung một khoá.
- Nút «Một người» bị khoá (không ẩn) kèm câu lý do, để người dùng thấy vì sao.
- Rebase lên `cr182-migrate`: `sign()` giữ logic lùi (`blocking: !old`), chỉ thêm nhãn `signer_role_label`.
- Nhập vai Ký mới: giữ trạng thái «đang gõ» ở panel để không bị tự điền vai mặc định đè lên.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED sht/cai-dat-va-quyen.md
#### Yêu cầu: Chuông «Chưa giao người» cũng tới quản trị gói Sổ Hợp Tác
Chuông gửi cho tenant admin VÀ người có quyền `admin` gói Sổ Hợp Tác (trực tiếp hoặc qua nhóm); người thường không nhận.
- Kịch bản: khi vai chưa giao mà HĐ không mở được lượt thì tenant admin và quản trị gói đều có chuông, người thường không [test: apps/hub-api/src/modules/processes/roles/roles-migrate.int.test.ts » quản trị gói Sổ Hợp Tác (quyền admin gói, không phải tenant admin) CŨNG nhận chuông, người thường không]

#### Yêu cầu: Quyền sửa giao việc do máy chủ quyết (can_edit)
`GET /pack/contracts/approval-flow` trả thêm `can_edit`: true cho quản trị công ty (tenant admin hoặc quản trị gói Sổ Hợp Tác), false cho người thường. Cài đặt › Quy trình duyệt chỉ mở khung giao việc khi `can_edit` true.
- Kịch bản: khi người thường, quản trị gói Sổ Hợp Tác (không phải tenant admin) và tenant admin gọi GET thì `can_edit` lần lượt false, true, true [test: apps/hub-api/src/modules/packs/contracts/adapters/approval-flow-roles.int.test.ts » GET /approval-flow: can_edit false cho người thường, true cho quản trị gói Sổ Hợp Tác (không phải tenant admin) và tenant admin]
- Kịch bản: khi quản trị gói Sổ Hợp Tác bấm bước có vai thì khung giao việc mở ra [test: e2e/cr181/journey-dot2.spec.ts » quản trị giao vai trên sơ đồ: «Trưởng phòng duyệt» và «Người ký hợp đồng» → nhóm, hết viền vàng]

#### Yêu cầu: Thành viên nhóm hiện ngay khi chọn nhóm
`GET /pack/contracts/groups/:id/members?offset&limit` trả thành viên dùng được của nhóm trong công ty (chỉ nhóm của công ty mình, tải dần theo `next`). Khung giao việc hiện danh sách (avatar, tên, chức vụ) ngay khi chọn nhóm, trước khi lưu, kèm «Xem thêm» khi nhóm lớn.
- Kịch bản: khi gọi API với limit nhỏ thì trả đúng trang, `next` còn khi còn người, nhóm lạ trả 404, tham số sai trả 400 [test: apps/hub-api/src/modules/packs/contracts/adapters/approval-flow-roles.int.test.ts » GET /groups/:id/members: người thường đọc được, tải dần theo trang (next), nhóm lạ ⇒ 404, tham số sai ⇒ 400]
- Kịch bản: khi chọn một nhóm chưa lưu thì thấy ngay danh sách thành viên [test: thủ công — UI, e2e cr182-qc chạy cuối đợt]

#### Yêu cầu: Vai của nhánh «cùng duyệt» chỉ giao cho nhóm
Vai dùng ở nhánh «cùng duyệt» có `group_only`; khung giao việc khoá lựa chọn «Một người» và nói lý do.
- Kịch bản: khi một khoá vai được dùng ở nhóm «cùng duyệt» của bất kỳ bước nào thì node có `groupOnly` [test: apps/hub-api/src/modules/packs/contracts/domain/event-flow-graph.rules.test.ts » CR-182 · vai dùng ở nhánh «cùng duyệt» của bất kỳ bước nào ⇒ groupOnly (chỉ nhận nhóm)]
- Kịch bản: khi mở khung giao việc của vai chỉ-nhóm thì nút «Một người» bị khoá kèm câu lý do [test: thủ công — UI, e2e cr182-qc chạy cuối đợt]

#### Yêu cầu: Màn xem quy trình hiện bước Ký theo vai
Bước Ký có vai người ký hiện «Người ký: <vai> · <người được giao>» và loại «Ký trên tài liệu» (hoặc «Cần chữ ký số» khi bật công tắc); không còn «Ký qua» cũ. Quy trình cũ chưa có vai giữ cách hiện cũ.
- Kịch bản: khi bước Ký có vai thì huy hiệu là «Ký trên tài liệu», bật công tắc thì «Cần chữ ký số» [test: apps/workspace-web/src/features/settings/lib/flow-view.test.ts » có vai ⇒ «Ký trên tài liệu» (không còn «Ký qua» cũ), «Cần chữ ký số» khi bật công tắc]
- Kịch bản: khi xem dạng danh sách thì có dòng «Người ký: <vai> · <người được giao>» [test: apps/workspace-web/src/features/settings/lib/flow-view.test.ts » danh sách có dòng người ký kèm người được giao, node có dòng người ký]
- Kịch bản: khi quy trình cũ chưa có vai thì giữ cách hiện theo «Ký qua» [test: apps/workspace-web/src/features/settings/lib/flow-view.test.ts » def cũ chưa có vai ⇒ giữ cách hiện cũ theo «Ký qua»]

#### Yêu cầu: Bước Ký nhập được vai mới (signer_role_label)
Ở trình soạn quy trình, bước Ký chọn vai có sẵn hoặc nhập vai mới; nhãn lưu ở `signer_role_label` (tuỳ chọn) và là nhãn của vai trên màn giao việc và báo «chưa giao».
- Kịch bản: khi mã hoá/giải mã cấu hình Ký thì giữ `signer_role_label`, nhãn quá 80 ký tự bị từ chối [test: packages/contracts/src/pack-contracts/esign-node.test.ts » encode và decode giữ nhãn vai mới, nhãn quá 80 ký tự bị từ chối]
- Kịch bản: khi vai Ký chưa giao thì báo bằng nhãn `signer_role_label` thay vì tên bước [test: packages/contracts/src/flow/with-roles.test.ts » Ký: có signer_role_label ⇒ vai chưa giao báo bằng nhãn này (không phải tên bước)]

## Việc còn lại
- Bước «cùng duyệt» không có vai chính: graph chỉ mang một vai mỗi bước nên chưa bấm giao được ở sơ đồ; cần mở rộng graph thành danh sách vai mỗi bước (ngoài lát này).
- tsc `apps/hub-api`: 1 lỗi có sẵn ở `messages/pmsg-db.int.test.ts:412` (không thuộc lát).

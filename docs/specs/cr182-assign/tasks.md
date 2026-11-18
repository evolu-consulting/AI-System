---
id: cr182-assign
lát: cr182-assign
cr: CR-182
làn: nhanh
migration: không
phụ thuộc: cr182-roles
---
## Plan (ngắn)
Sổ Hợp Tác › Cài đặt › Quy trình duyệt: node có vai hiện «Vai · <nhãn>» + người được giao (nhóm kèm số người / avatar + tên), chưa giao ⇒ viền vàng «⚠ Chưa giao người». Quản trị công ty bấm bước ⇒ khung bên (sheet ở điện thoại) giao Nhóm hoặc Một người, «Lưu giao việc» có xác nhận. Dưới sơ đồ: «Còn n vai chưa giao người…» / «Mọi bước đã có người làm.». Thành viên thường chỉ xem.

## Làm
- [x] `packages/flow-canvas`: `DefRoleView`, `role`/`selected` trên node, viền vàng + vòng chọn (theme `stepWarn`/`stepPick`/`roleLine`/`warnLine`).
- [x] `settings/lib/flow-roles.ts` (thuần) + `lib/current-flow.ts` đọc `graph[].role/assigned`; `api-roles.ts` (`PUT /pack/contracts/approval-flow/roles`).
- [x] `FlowAssignPanel` (VAI · nhãn, các bước dùng vai, Nhóm | Một người, thành viên, Bỏ thay đổi / Lưu giao việc + hộp xác nhận); `FlowCurrentPane` ghép + chân sơ đồ.
- [x] i18n `contracts.flow.current.assign.*` (v2l vi/en); e2e `e2e/contracts-web/cr182-assign.cw.ts` (viết, chưa chạy).

## Không làm / Chạm
Không làm: API backend mới, trình soạn admin. Chạm: flow-canvas (def-graph, DefViewNodes, theme), workspace-web/settings, i18n v2l.

## Test tối thiểu
unit `flow-roles.test.ts`, `def-graph.test.ts`; e2e `cr182-assign.cw.ts` (cr182-qc chạy cuối đợt).

## Quyết định trong lúc làm
- Quyền sửa = `isCompanyAdmin(role)` (API chưa có `can_edit`); server vẫn chặn người thường ở PUT.
- Khung chọn node bằng `onNodeClick` ở mode `view` (không bật kéo/nối); chỉ bước có `role` mở được khung.
- Nhóm đang chọn nhưng chưa lưu: chưa có API thành viên nhóm cho workspace ⇒ ghi «Danh sách thành viên hiện sau khi lưu»; nhóm đã lưu thì liệt kê từ `assigned.members`.
- Avatar trên node là chữ cái đầu (gói flow-canvas không phụ thuộc web-kit); ô chọn người dùng `PersonPick` (avatar thật).
- Nhánh «cùng duyệt» chỉ nhận nhóm: UI chưa chặn «Một người» (graph không nói kiểu nhánh) — server coi là chưa giao.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED sht/cai-dat-va-quyen.md
#### Yêu cầu: Giao việc theo vai ở Cài đặt › Quy trình duyệt
Bước có vai hiện «Vai · <nhãn>» và người được giao (nhóm kèm số người, hoặc người); chưa giao thì viền vàng «⚠ Chưa giao người». Quản trị công ty bấm bước để giao nhóm hoặc một người cho vai (một vai nhiều bước giao một lần), lưu có xác nhận: bước chưa tới lượt dùng người mới, việc đang chờ giữ người cũ. Dưới sơ đồ nói còn bao nhiêu vai chưa giao. Thành viên thường chỉ xem.
- Kịch bản: khi quản trị giao nhóm cho vai rồi lưu thì node hết viền vàng và dòng dưới sơ đồ báo mọi bước đã có người [test: e2e/contracts-web/cr182-assign.cw.ts » CR-182 · quản trị giao nhóm cho vai ⇒ Lưu giao việc ⇒ node hết viền vàng]
- Kịch bản: khi thành viên thường bấm bước thì không mở khung giao việc và có câu «Chỉ quản trị công ty đổi được» [test: e2e/contracts-web/cr182-assign.cw.ts » CR-182 · thành viên thường chỉ xem: bấm bước không mở khung, có câu «Chỉ quản trị công ty đổi được»]
- Kịch bản: khi xem trên điện thoại 390px thì khung giao việc là sheet và nút lưu cao ít nhất 44px [test: e2e/contracts-web/cr182-assign.cw.ts » CR-182 · điện thoại 390px: khung giao việc là sheet, nút ≥ 44px]
- Kịch bản: khi bước có vai thì node mang vai, người được giao và dấu chọn [test: packages/flow-canvas/src/layout/def-graph.test.ts » node mang vai + người, bước đang chọn đánh dấu selected]
- Kịch bản: khi đếm vai chưa giao thì tính theo khoá vai, một vai nhiều bước chỉ đếm một lần [test: apps/workspace-web/src/features/settings/lib/flow-roles.test.ts » một vai nhiều bước và đếm vai chưa giao theo khoá khác nhau]
- Kịch bản: khi nháp giống bản đã lưu thì nút «Lưu giao việc» không bật [test: apps/workspace-web/src/features/settings/lib/flow-roles.test.ts » isDirty chỉ bật khi nháp khác bản đã lưu]

## Việc còn lại
- Cần backend-lead (không bắt buộc): `can_edit` trong GET approval-flow; API thành viên nhóm cho nhóm chưa giao (xem trước khi lưu).

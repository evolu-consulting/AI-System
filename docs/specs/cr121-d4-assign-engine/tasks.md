---
id: cr121-d4-assign-engine
lát: cr121-d4-assign-engine
cr: CR-121
làn: nhanh
migration: không
phụ thuộc: độc lập D-1..D-3 (không đụng approval-flow*.rules, approval-engine.tools, approval-engine*.usecase)
---
## Plan (ngắn)
Spec: `docs/specs/cr121-d/spec.md` R7 (D-4). Hiện công ty phải bật feature ẩn `contracts-approval-engine` thì duyệt HĐ mới chạy theo quy trình;
gán quy trình ở Công ty › Quy trình mà không bật ⇒ không có nút duyệt (vi phạm Luật GỐC 3). Đổi cổng engine sang "đã gán":
nguồn duy nhất = luật định tuyến `hub.process_routing_rules` của công ty × khe `contracts.approval` (gán ở Admin ghi luật `is_default`
trỏ def riêng + tập gán; luật điều kiện ghi thêm). "Đã gán" = có ≥ 1 luật KHÔNG phải mặc định-của-khe (`is_default` ∧ def = `process_slots.default_def_id`
do `ensureSlotDefaults` cấp là CHƯA gán). Chưa gán ⇒ máy cũ (phần A dọn sau — máy cũ KHÔNG xoá ở lát này).

## Làm
- `processes/library/slot-assigned.repo.ts` (mới): `slotAssigned` — MỘT câu SQL cố định theo index (tenant, slot), scope system; nối vào cổng
  `PackRunsPort.slotAssigned?` → `ApprovalEnginePort.slotAssigned?` (additive, optional).
- `approval-engine.rules.ts`: bỏ `ENGINE_FEATURE_KEY`; `engineAllowedForTenant({env, assigned})`. `approval.mount.ts`: cổng đọc `slotAssigned`
  (1 câu, chỉ lúc mở lượt MỚI — không ở đường duyệt/mở thẻ); bỏ đọc feature; `engineOff` luôn false (không còn ca "đã gán mà không chạy").
- Admin-web: bỏ công tắc "Duyệt theo quy trình" + ghi chú engine-off (TenantProcessSlots/SlotRouting/AppCard, xoá `lib/engine-toggle*`);
  `feature-meta.isHiddenFeature` ẩn feature khỏi danh mục (Features, thẻ app, tab app) và không bao giờ cấp/thu hồi khi lưu; xoá i18n `tenants.slots.engine*`.
- Manifest Sổ Hợp Tác (`packages/contracts/.../contracts.manifest.ts`): bỏ add-on khỏi khe `contracts.approval` + action `approve-flow` + danh sách add-on
  (không còn cảnh báo "cần add-on" ở xem trước/tổng quan).
- Seed/onboard (D7): `seed-niti` không cấp feature (bỏ `seed-niti.engine.ts`, tuỳ chọn `engine`); `seed.tenant-fixtures` + hub-dev fixture không cấp
  feature; gán quy trình là đủ.
- Ops `flow_coverage`: thay nhánh `engine_off` (thiếu feature) bằng `unrouted` (còn lượt duyệt đang chạy mà khe hết luật) + `broken` (luật trỏ quy
  trình đã xoá/chưa xuất bản, hoặc run duyệt HĐ kẹt `needs_decision`) — crit nêu tên công ty + cách sửa.

## Không làm / Chạm
- Không xoá máy cũ (needsLevel2, `mode='machine'`), không migration (hàng feature + entitlement cũ còn nguyên, chỉ không ai đọc).
- Không sửa D-1: `approval-flow*.rules.ts`, `adapters/approval-engine.tools.ts`, `approval-engine*.usecase.ts`.
- Để lại cho phần A / D-5: `engine_off` ở `approval.usecase.ts`/`extraction.mount.ts`/`packages/contracts/.../approval.ts` + `EngineOffNote.tsx` + i18n
  `contracts.approval.engineOff` (không còn phát cờ, UI vô hại); e2e `journey-approval/*` + `deployed/21-*` còn tham chiếu `tenant-engine-switch` /
  `tenant-engine-off-note` (D-5 viết lại); `docs/current` + CLAUDE.md D7 + `deploy/prod-sohoptac2/env.template` + `scripts/dev-up.ps1` còn nhắc feature (gộp cuối đợt).
- Ops không thấy được `contracts.approvals` (cách ly gói: hub_api không có quyền đọc) ⇒ HĐ chờ duyệt chạy máy cũ của công ty chưa gán không đếm được ở ops.
- Env `CONTRACTS_APPROVAL_ENGINE=on` vẫn là công tắc khẩn của vận hành (không phải feature).

## Test tối thiểu
- unit: `approval-engine.rules.test.ts` (env × đã gán), `flow-coverage.check.test.ts`, admin-web `feature-meta`/`feature-assign`.
- int: `tests/acceptance/CF/engine-tenant-gate.int.test.ts` (chưa gán ⇒ máy cũ; gán ⇒ engine, không feature; bỏ gán ⇒ máy cũ),
  `ops.flow-coverage.int.test.ts` (đỏ khi lệch, ok khi sửa), `seed-niti.int.test.ts` + `seed.tenant-fixtures.int.test.ts` (không cấp feature).
- Xoá `tests/acceptance/CF/engine-off-flag.int.test.ts` (ghi chú engine_off theo feature không còn).

## Quyết định trong lúc làm
- Cổng ở mức công ty (không theo người khởi tạo) để cùng công ty cho cùng kết quả; `routeSlot` theo người sẽ lệch khi luật phòng ban chỉ trúng luật mặc định.
- Thêm `slotAssigned` vào port thay vì dùng `routeSlot`/`resolveSlot`: hai hàm đó trả theo người/mẫu khe, không phân biệt "đã gán" ở mức công ty.
- Ops dùng dữ liệu hub (process_runs/defs/luật) vì không đọc được bảng gói.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED sht/duyet-ky-so.md
#### Yêu cầu: Gán quy trình duyệt hợp đồng là đủ để HĐ mới duyệt theo quy trình
Công ty được gán quy trình riêng cho khe "Duyệt hợp đồng" (luật chọn quy trình không phải mặc định của khe) thì hợp đồng MỚI vào bước duyệt chạy trên
engine quy trình, không cần bật tính năng nào khác; công ty chưa gán vẫn duyệt theo cách cũ; bỏ gán thì HĐ mới về cách cũ, lượt đã chạy engine chạy nốt.
Env `CONTRACTS_APPROVAL_ENGINE` ≠ `on` vẫn tắt hết (công tắc khẩn).
- Kịch bản: khi công ty chưa gán thì HĐ mới ở máy cũ; gán quy trình riêng thì HĐ mới ở engine dù không có feature; bỏ gán thì HĐ mới về máy cũ và lượt đã engine giữ nguyên [test: tests/acceptance/CF/engine-tenant-gate.int.test.ts » chưa gán ⇒ máy cũ, gán ⇒ engine (không có feature/entitlement nào), bỏ gán ⇒ máy cũ]
- Kịch bản: cổng chỉ cho env on và đã gán [test: apps/hub-api/src/modules/packs/contracts/domain/approval-engine.rules.test.ts » chỉ env=on ∧ đã gán, chưa gán ⇒ máy cũ, env off/vắng tắt hết]

### MODIFIED sht/cai-dat-va-quyen.md
#### Yêu cầu: Feature contracts-approval-engine không còn là công tắc hay danh mục hiển thị
Admin không còn công tắc "Duyệt theo quy trình" và không liệt kê/cấp/thu hồi feature `contracts-approval-engine`; seed/onboard công ty không cấp feature đó;
khe "Duyệt hợp đồng" không còn đòi add-on ở xem trước.
- Kịch bản: feature ẩn không có trong nhóm danh mục và không bị cấp/thu hồi khi lưu thẻ app [test: apps/admin-web/src/features/tenants/lib/feature-assign.test.ts » CR-121 D-4 · feature ẩn (contracts-approval-engine) không vào entitledKeys và không bao giờ bị thu hồi/cấp khi lưu]
- Kịch bản: duyệt theo quy trình không cần tính năng thêm ở xem trước [test: packages/contracts/src/app-manifest/preview.test.ts » CR-121 D-4 · duyệt theo quy trình KHÔNG cần tính năng thêm: đủ mức Sửa là hiện, khe chạy kèm quy trình đang gán]
- Kịch bản: seed-niti không cấp feature engine [test: tools/scripts/src/seed-niti.int.test.ts » --apply tạo đủ và mật khẩu chỉ ở file, không ở log]

### ADDED ops/flow-coverage.md
#### Yêu cầu: Cấu hình duyệt hợp đồng nửa vời bị ops-watch bắt
Check `flow_coverage` đỏ (crit, nêu tên công ty + cách sửa, không nhắc feature) khi công ty còn lượt duyệt HĐ đang chạy mà khe hết luật gán, hoặc luật trỏ
quy trình đã xoá/chưa xuất bản, hoặc run duyệt HĐ kẹt chờ quyết định; sửa xong thì xanh.
- Kịch bản: công ty có luật trỏ quy trình đã xoá và công ty còn run duyệt mà không còn luật ⇒ crit nêu tên cả hai; sửa ⇒ ok [test: apps/hub-api/src/modules/ops/ops.flow-coverage.int.test.ts » CR-121 D-4 · luật trỏ quy trình đã xoá / còn lượt duyệt mà hết luật ⇒ crit nêu tên (không nhắc feature), sửa ⇒ ok]
- Kịch bản: thông điệp crit nêu tên + cách sửa [test: apps/hub-api/src/modules/ops/adapters/checks/flow-coverage.check.test.ts » gỡ gán giữa chừng (còn lượt duyệt) ⇒ crit nêu tên công ty + cách sửa, không nhắc feature]

## Việc còn lại
- D-5 / điều phối: cập nhật e2e `journey-approval` + `deployed/21-*` (bỏ `tenant-engine-switch`/`tenant-engine-off-note`); `bun run test:lock:write` sau khi qc gộp.
- Phần A: gỡ `engine_off`/`EngineOffNote`/máy cũ; gộp `docs/current` + CLAUDE.md D7 + env.template + dev-up.ps1.

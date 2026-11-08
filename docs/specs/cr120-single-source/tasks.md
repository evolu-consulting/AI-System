---
id: cr120-single-source
lát: cr120-single-source
cr: CR-120 (§3, FLOW-FR-04..05) · ADR-0036
làn: đầy đủ (migration dữ liệu khách + RLS/tenant)
migration: hub 0090_slot_default_rules (when 1803600000000), hub 0091_slot_assign_view (when 1803700000000)
phụ thuộc: hub-routing-backfill (hub 0089)
---
## Plan (ngắn)
Một nguồn gán: `process_tenant_defs` + `process_routings`/`process_routing_rules` (luật `is_default` = gán). Bảng gán cũ
`process_slot_assignments` ⇒ `_legacy` (giữ dữ liệu, không cấp hub_rw) + VIEW cùng tên chỉ đọc (`security_invoker`) từ luật mặc định
(một bản phát hành; CR-121 xoá). `resolveSlot`/`routeSlot`/`currentOf` chỉ đọc luật + mẫu khe. Đường gán cũ (PUT/DELETE
process-slots, `assignByKey` onboarding, seed CR-113, script backfill CR-105) ghi luật mặc định. `ensureSlotDefaults` (boot + mỗi lần
cấu hình đổi, KHÔNG ở migration) cấp mẫu khe cho tenant bật app chưa có luật.

## Quyết định trong lúc làm
- 0090 chỉ tạo luật mặc định cho tenant × khe CHƯA có luật nào (launch cũ khi có luật bỏ qua gán cũ ⇒ giữ launch). Tenant đã có luật
  không mặc định giữ nguyên (`route_none` như cũ). Hệ quả: `resolveSlot` (GET /approval-flow, DLC, launch không người khởi tạo) của
  tenant ĐÃ có luật nay theo luật mặc định / mẫu khe thay vì gán cũ (câu cũ lệch với launch) — chứng minh + ghi ở int.
- `resolveSlot`: luật mặc định ⇒ không có ⇒ mẫu khe `process_slots.default_def_id` (tenant chưa được cấp vẫn chạy như cũ).
  `is_default` = def hiệu lực là mẫu khe (luật mặc định trỏ đúng mẫu ⇒ vẫn "mặc định"), để tenant được cấp không đổi nhãn.
- `ensureSlotDefaults` chỉ cấp khi tenant × khe chưa có luật nào (không đè luật tenant admin đặt, kể cả không mặc định); mẫu phải
  chưa xoá + đã xuất bản; bỏ `dlc.*`. Không audit/NOTIFY (cấp phát hệ thống; không gây vòng `config_changed`). Bật chỉ từ `server.ts`
  (`slotDefaults: true`) để test in-process không tự ghi luật.
- DELETE process-slots = xoá luật mặc định (+ version đầu luật + 1); PUT = đổi/chèn luật mặc định (priority trống cao nhất ≤ 49) +
  version + 1 (màn luật đang mở nhận 409).
- ops `flow_coverage`: bỏ nhánh đọc gán cũ (VIEW dẫn xuất từ luật đã nằm trong nhánh luật).
- Seed CR-113: tenant đang ở mẫu khe (do ensure cấp) ⇒ thay bằng def CR-113 (như gán cũ "chưa gán ⇒ gán"); script backfill CR-105
  (one-off) coi "có luật mặc định" = đã gán.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)

### MODIFIED engine/thu-vien-quy-trinh.md
#### Yêu cầu: Một nguồn gán quy trình (ADR-0036)
Gán tenant × khe chỉ nằm ở tập gán + luật `is_default`; `process_slot_assignments` là VIEW chỉ đọc dẫn xuất (bảng cũ `_legacy`).
- Kịch bản: khi chạy 0090/0091 trên DB có gán cũ thì launch của mọi tenant × dữ kiện lượt không đổi [test: apps/hub-api/src/modules/processes/library/slot-single-source.int.test.ts » launch không đổi cho mọi tenant × dữ kiện lượt, resolveSlot chỉ đổi ở tenant đã có luật (ghi rõ)]
- Kịch bản: khi chạy lại 0090/0091/ensure thì không đổi gì; tenant bật app chưa có luật được cấp mẫu khe [test: apps/hub-api/src/modules/processes/library/slot-single-source.int.test.ts » ensureSlotDefaults (boot) cấp đúng tenant bật app chưa có luật, chạy lại vô hại]
- Kịch bản: khi scope user đọc VIEW thì chỉ thấy tenant mình; ghi qua VIEW và đọc `_legacy` bị 42501 [test: apps/hub-api/src/modules/processes/library/slot-single-source.int.test.ts » CR-121 A1 · hub 0099 gỡ VIEW process_slot_assignments, gán hiệu lực đọc từ luật mặc định, bảng _legacy không cấp cho hub_rw và còn dữ liệu cũ]
- Kịch bản: khi VIEW vắng thì resolveSlot/routeSlot vẫn đúng [test: apps/hub-api/src/modules/processes/library/slot-single-source.int.test.ts » resolveSlot/routeSlot chỉ đọc nguồn mới (không còn đối tượng process_slot_assignments)]
- Kịch bản: khi tenant đọc chéo / ghi bảng gán thì bị chặn [test: apps/hub-api/src/modules/processes/library/library-rls.int.test.ts » chặn đọc chéo tenant bảng gán, release, khe]
- Kịch bản: khi platform_admin PUT/DELETE gán cũ thì luật mặc định đổi/xoá, tập gán đồng bộ [test: apps/hub-api/src/modules/processes/library/routing-backfill.int.test.ts » PUT gán cũ ⇒ hiện trong routing, thay ⇒ bỏ def cũ khỏi tập, DELETE giữ def khi luật còn dùng]

#### Yêu cầu: flow_coverage sau khi cấp mặc định
- Kịch bản: khi tenant bật app chỉ chạy bằng mẫu khe thì crit; sau ensureSlotDefaults thì ok [test: apps/hub-api/src/modules/ops/ops.flow-coverage.int.test.ts » sau ensureSlotDefaults (cấp mẫu khe cho tenant bật app) và gán lại def sống ⇒ ok]

## Việc còn lại
- Tranh chấp test (khoá, qc sửa): `tests/acceptance/CF/approval-dify.int.test.ts:103` `insert into hub.process_slot_assignments` ⇒ nay
  VIEW chỉ đọc (42501). Sửa: dùng `setSlotDefault` (`apps/hub-api/src/test-support/slot-default.ts`) hoặc ghi luật mặc định.
- CR-121: xoá VIEW + `_legacy`; đổi người đọc VIEW còn lại (capabilities.repo, library.repo/defs.repo `tenant_count`,
  slot-assign `affectedCte`/`listAssignments`) sang luật trực tiếp.
- Rollback: `HUB` không có down-migration; một bản phát hành giữ `_legacy` để đối chiếu.

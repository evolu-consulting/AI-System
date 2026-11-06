---
id: cr122-f0-flowdef-contract
lát: cr122-f0-flowdef-contract
cr: CR-122
làn: đầy đủ (contract nhiều lát dựa vào)
migration: không
phụ thuộc: —
---
## Plan (ngắn)
Contract nền CR-122 (ADR-0038, flow-model.md A–D, spec FLOW2-FR-01/02/12/15/17/18): chỉ kiểu + zod + cổng + check, cộng thêm, không gỡ gì cũ.

## Làm
- `packages/contracts/src/hub-admin/process-flowdef.ts` (mới): `FlowDefSchema` (key, name, app, owner, `trigger {event, when?}`, stages, source, version), `FactWhenSchema` (AND/OR lồng 1 cấp, ≤ 6 vế), `flowDefIssues(def, events?)`, `parseFlowDef` (không `trigger` ⇒ `legacy`, chỉ kiểm `stages`).
- `processes.ts`: `ProcessStageDefSchema` + `next_step` (bước gộp) + `outcome` (node Kết thúc) — optional.
- `process-company-flows.ts` (mới): view model `CompanyFlowRowSchema` cho E1 (API) / U2 (màn).
- `app-manifest/manifest.ts`: `AppEventDecl {key,label,facts[],outcomes[],decides,required,defaultFlowKey?}`, `AppManifest.events`; `AppSlotDecl`/`slots` `@deprecated` (gỡ R1).
- `contracts.manifest.ts`: `contract.submitted` (decides+required, mặc định `hd-mac-dinh`), `contract.uploaded`, `contract.approved`. `community.manifest.ts`: `post.created`, `partner.join_requested`, `report.created` (cả ba decides).
- `app-manifest/events.rules.ts` (mới) `appEventIssues` + `tools/scripts/src/check-app-events.ts` + `check:app-events` (vào chuỗi `bun run check`).
- `packs/kit/application/flow-events.ports.ts` (mới): `FactsReader`, `OutcomeHandler<TX>`, `FlowEventInput`, `FlowFacts`; export ở `kit/public.ts`; `SlotSpec` `@deprecated`.

## Không làm / Chạm
Không engine chạy, migration, UI, DLC. `FlowView.slot` chưa bỏ (U2/E1 đổi `FlowRuntime` tra theo `ref`). `FlowSlotAdapter`, `process-routing.ts`, `process-company.ts` giữ tới R1.

## Test tối thiểu
`bun test packages/contracts/src/hub-admin/process-flowdef.test.ts packages/contracts/src/app-manifest/` (30 pass). tsc sạch: contracts, hub-api, admin-web, workspace-web (tools/scripts có 3 lỗi cũ ở `evotest-summary.rules.ts`, không do lát). `check:app-events`, `check:app-slots`, `check:size` xanh; `check:boundaries` 289/289 (không tăng); depcruise không thêm vi phạm.

## Quyết định trong lúc làm
- Node Kết thúc = stage có `outcome` (F0 không thêm `executor.kind` mới); E2 chọn executor cho Kết thúc (vd `finish`) và thêm vào union.
- "≤ 20 bước" đếm BƯỚC khác nhau (`resolveSteps`), stage vẫn ≤ `PROCESS_STAGES_MAX` (22).
- Khoá dữ kiện contracts giữ như `APPROVAL_SLOT_FIELDS` (`total_value`, `deal`, `creator_department`, `new_partner`) để M1 backfill không đổi tên.
- Community cả ba sự kiện `decides` theo brief F0 (flow-model mục C không ghi cột decides cho community).
- Event key duy nhất trên mọi app (bộ điều phối khớp theo khoá, không theo app).
- `check:app-events`: sự kiện `required` thiếu flow mặc định / không có trong seed ⇒ CẢNH BÁO (`STRICT_DEFAULT_FLOW = false`) — seed hiện chỉ là def khe cũ chưa có `trigger`.
- `OutcomeHandler<TX>` generic: kit lớp 2 không phụ thuộc `@ai/db`; E2 gắn `Tx` của `apply-settle.ts`.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED current/engine/flow-def.md
#### Yêu cầu: Một định dạng FlowDef có node Bắt đầu khi và Kết thúc (FLOW2-FR-01/02/12/15)
Flow (Thư viện, bản công ty, mẫu chạy thử) có đúng một `trigger {event, when?}`, `stages` theo định dạng engine cộng `next_step` (bước gộp) và `outcome` (node Kết thúc); ≤ 20 bước, ≥ 1 Kết thúc; điều kiện AND/OR lồng một cấp trên dữ kiện app khai. Def/snapshot cũ không có `trigger` vẫn đọc được để chạy nốt.
- Kịch bản: khi flow có 1 trigger và ≥ 1 Kết thúc thì hợp lệ [test: packages/contracts/src/hub-admin/process-flowdef.test.ts » hợp lệ: 1 trigger, ≥ 1 Kết thúc ⇒ ok, không legacy, mặc định source/version null]
- Kịch bản: khi không có node Kết thúc thì từ chối [test: packages/contracts/src/hub-admin/process-flowdef.test.ts » không có node Kết thúc ⇒ FLOW_NO_FINISH]
- Kịch bản: khi quá 20 bước thì từ chối [test: packages/contracts/src/hub-admin/process-flowdef.test.ts » > 20 bước ⇒ FLOW_TOO_MANY_STEPS, đúng 20 ⇒ hợp lệ]
- Kịch bản: khi `next_step` lùi hoặc Kết thúc đi tiếp thì từ chối, gộp nhánh tiến về sau thì hợp lệ [test: packages/contracts/src/hub-admin/process-flowdef.test.ts » next_step lùi/vượt ⇒ FLOW_NEXT_STEP_INVALID, Kết thúc có next_step ⇒ FLOW_FINISH_NEXT]
- Kịch bản: khi sự kiện/kết quả/dữ kiện không thuộc manifest app thì báo lỗi đúng vị trí [test: packages/contracts/src/hub-admin/process-flowdef.test.ts » theo manifest: sự kiện lạ, outcome không thuộc sự kiện, dữ kiện/kiểu sai ⇒ lỗi tương ứng]
- Kịch bản: khi def cũ không có trigger thì vẫn hợp lệ để chạy snapshot [test: packages/contracts/src/hub-admin/process-flowdef.test.ts » không trigger, có slot/after.branch ⇒ hợp lệ legacy, giữ trường khác, không áp luật mới]

### ADDED current/engine/app-events.md
#### Yêu cầu: App khai sự kiện trong manifest, kiểm bằng check:app-events (FLOW2-FR-17/18)
Mỗi app khai `events[] {key,label,facts[],outcomes[],decides,required}`; contracts: `contract.submitted` (decides + required), `contract.uploaded`, `contract.approved`; community: `post.created`, `partner.join_requested`, `report.created`. `bun run check:app-events` đỏ khi app không có sự kiện hoặc khai sai; sự kiện required thiếu flow mặc định trong seed hiện chỉ cảnh báo.
- Kịch bản: khi manifest thật được kiểm thì không lỗi và đúng danh mục [test: packages/contracts/src/app-manifest/events.rules.test.ts » manifest thật (contracts, community) không lỗi, đúng danh mục mục C]
- Kịch bản: khi app không có sự kiện thì đỏ [test: packages/contracts/src/app-manifest/events.rules.test.ts » app không có sự kiện ⇒ no_events]
- Kịch bản: khi sự kiện required thiếu flow mặc định thì cảnh báo, chế độ strict thì đỏ [test: packages/contracts/src/app-manifest/events.rules.test.ts » required thiếu flow mặc định / không có trong seed ⇒ cảnh báo (mặc định), lỗi khi strict]

## Việc còn lại
- E1: dùng `FlowEventInput` (eventId = khoá idempotent), `CompanyFlowRowSchema`; lưu `trigger` vào `company_flows`/def; validate bằng `parseFlowDef` + `flowDefIssues(def, manifest.events)`.
- E2: executor cho Kết thúc + `fact` vào `CondFromSchema` của If (dùng `FactCondSchema`/`FACT_KEY_RE`); gắn `OutcomeHandler<Tx>`; `next_step` trong `apply.rules.ts`.
- U1: control điều kiện chung đọc `FactWhenSchema` + `AppEventDecl.facts` (kiểu → toán tử theo `condOk`).
- M1: seed FlowDef có `trigger` rồi bật `STRICT_DEFAULT_FLOW = true` trong `check-app-events.ts`.
- R1: gỡ `AppSlotDecl`/`slots`, `SlotSpec`, `check:app-slots`.

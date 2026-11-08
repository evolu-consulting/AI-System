---
id: cr120-runtime-on
lát: cr120-runtime-on
cr: CR-120
làn: đầy đủ (đổi đường hành động duyệt + idempotent trên use case trạng thái) — một agent
migration: không
phụ thuộc: — (gộp sau community-flows theo spec §8)
---
## Plan (ngắn)
Spec `docs/specs/CR-120/spec.md` §4 + ADR-0036 §5. Bật flow runtime mặc định, thẻ duyệt quyết qua `FlowRuntime.act`, FlowPanel đọc
FlowView của hub, giữ endpoint approvals cũ một bản phát hành cho rollback `HUB_FLOW_RUNTIME=off`.

## Làm
- [x] hub `flowRuntimeOn`: `seam ?? env !== "off"` (mặc định bật); unit cờ.
- [x] deploy kit prod: `HUB_FLOW_RUNTIME: ${HUB_FLOW_RUNTIME:-on}` (compose) + dòng `env.template` (`off` = rollback).
- [x] hub: hành động qua flow mang `expect {taskId, step}` ⇒ use case kiểm lại (máy cũ: trong khoá HĐ, so id lượt + giai đoạn;
      engine: so task engine định quyết) ⇒ bấm lại / đua cùng task KHÔNG quyết bước kế (409). Route cũ không gửi ⇒ y hệt trước.
- [x] web `platform/flow/adapters/legacy-act.ts` (một file, CR-121 xoá): runtime tắt ⇒ `act` đi `POST …/contracts/:id/approval`.
- [x] web `useApproval.act` ⇒ `flowRuntime.act("contracts.approval", id, task_id, action, {feedback, extension: products})`;
      bỏ `actApproval` khỏi `contract-approval/api.ts`.
- [x] web `ApprovalTimeline`: FlowView từ `GET /pack/contracts/flow/contracts.approval/:id` (+ tên phòng từ `/groups`), tải lại khi
      thẻ đổi; view null (rollback) ⇒ phép chiếu cũ `flowViewOfApproval` (CR-121 xoá).
- [x] int `tests/acceptance/CR120/runtime-on.int.test.ts`; e2e contracts-web chuyển sang route flow (`flow-mock.ts`) + ca rollback.

## Không làm / Chạm
- Không migration, không đổi engine/route đóng băng; endpoint approvals cũ giữ nguyên (rollback). Không đụng DLC.
- Chạm chung (ít): `deploy/prod-sohoptac2/{docker-compose.yml,env.template}`, `apps/hub-api/.../approval.usecase.ts` +
  `approval-engine-card.usecase.ts` (trường `expect` tuỳ chọn), `e2e/contracts-web/*` (mock), `tests/.lock`.

## Test tối thiểu
- unit: `approval-flow-slot.usecase.test.ts` (cờ, `expect`), `http.test.ts` (rollback legacy-act), `flow-view.test.ts`
  (`withGroupLabels`), `approval.test.ts` (`flowActionOf`).
- int (evotest): CR120 runtime-on + CR118 flow-runtime + CF approval-* / owner-* + HD3 flow/starter + approval-engine-slot.
- e2e (evotest, một lần): `-Step e2e -All -Filter contracts-web,P-a`.

## Quyết định trong lúc làm
- Idempotent: kiểm task trước khi gọi use case (CR-118) có kẽ hở TOCTOU (task kế mở giữa kiểm và quyết ⇒ bấm lại quyết bước kế) ⇒
  thêm `expect` kiểm lại trong use case. Máy cũ: task id = id lượt (không đổi cấp 1→2) ⇒ so thêm giai đoạn.
- Tên phòng: FlowView của hub chỉ mang nhãn khi chuyển cấp ⇒ web điền tên theo `assignee.id` từ `/groups` (chỉ trình bày). Khi đã
  chuyển cấp, nhãn phòng = phòng nhận chuyển cấp (hub), khác thẻ cũ (phòng ban đầu) — chấp nhận.
- `overdue` lấy từ hub (server tính), web không tự tính nữa trên đường chính.
- FlowView tải lại theo thẻ (đổi dữ liệu thẻ ⇒ invalidate view), không thêm invalidate trong `refresh` (tránh 2 GET mỗi hành động).
- e2e contracts-web không có hub thật ⇒ `/pack/me` giả trong `flow-mock.ts` (cờ `flow.runtime`).

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)

### MODIFIED engine/flow-runtime.md
#### Yêu cầu: Flow runtime mặc định bật, `HUB_FLOW_RUNTIME=off` là rollback (FLOW-FR-06) (nguồn: cr120-runtime-on)
Route flow chung của kit gắn mặc định; chỉ `HUB_FLOW_RUNTIME=off` tắt (route 404, `/pack/me.flags["flow.runtime"]=false`). Deploy kit
prod đặt mặc định `on`. Endpoint approvals cũ giữ một bản phát hành.
- Kịch bản: khi không đặt env thì runtime bật; chỉ "off" tắt; seam thắng env [test: apps/hub-api/src/modules/packs/contracts/application/approval-flow-slot.usecase.test.ts » cờ: mặc định BẬT (CR-120)]
- Kịch bản: khi hub chạy không đặt env thì `/flow/*` có mặt và cờ `/pack/me` bật [test: tests/acceptance/CR120/runtime-on.int.test.ts » route /flow/* có mặt + /pack/me.flags flow.runtime = true]
- Kịch bản: khi `HUB_FLOW_RUNTIME=off` thì `/flow/*` 404, cờ tắt và endpoint approvals cũ vẫn quyết [test: tests/acceptance/CR120/runtime-on.int.test.ts » /flow/* 404, cờ tắt]
#### Yêu cầu: Hành động qua FlowRuntime idempotent, quyền như đường cũ (FLOW-FR-06) (nguồn: cr120-runtime-on)
Hành động `contracts.approval` qua flow gọi CÙNG use case thẻ duyệt, kèm task/giai đoạn người bấm thấy; use case kiểm lại (trong khoá
HĐ ở máy cũ, theo task engine định quyết ở engine) ⇒ bấm lại hoặc đua cùng task không quyết bước kế. Quyền, mã lỗi như đường cũ;
đối tác 403; tenant khác 403/404, không đổi trạng thái.
- Kịch bản: khi bấm lại Duyệt với task đã quyết thì 409 và trạng thái bước không đổi [test: tests/acceptance/CR120/runtime-on.int.test.ts » act qua flow = use case cũ]
- Kịch bản: khi hai lần Duyệt song song cùng task thì đúng một thành công, bước kế vẫn mở [test: tests/acceptance/CR120/runtime-on.int.test.ts » đua: 2 lần Duyệt song song cùng task]
- Kịch bản: khi người không vai quyết thì 403 ở cả flow lẫn approvals; thiếu lý do ⇒ cùng mã như cũ [test: tests/acceptance/CR120/runtime-on.int.test.ts » quyền như đường cũ]
- Kịch bản: khi tenant khác hoặc đối tác quyết thì bị chặn, trạng thái không đổi [test: tests/acceptance/CR120/runtime-on.int.test.ts » tenant khác (Db) ⇒ 403/404]
- Kịch bản: khi adapter gọi use case thì kèm `expect {taskId, step}` [test: apps/hub-api/src/modules/packs/contracts/application/approval-flow-slot.usecase.test.ts » act: đúng task ⇒ gọi actApproval y nguyên]

### MODIFIED sht/duyet-ky-so.md
#### Yêu cầu: Thẻ duyệt quyết qua FlowRuntime, dòng thời gian đọc FlowView của hub (nguồn: cr120-runtime-on)
Xác nhận/Duyệt/Trả lại/Từ chối (+ lý do, + SP gắn ở hộp "Gắn sản phẩm" = `extension`) gửi `POST /pack/contracts/flow/contracts.approval/:id/tasks/:task/actions/:action`
với task đang mở của thẻ. Dòng thời gian đọc `GET /pack/contracts/flow/contracts.approval/:id` (tên phòng từ `/groups`), tải lại khi
thẻ đổi; chữ, khung, data-testid giữ nguyên. Cờ `flow.runtime` tắt (rollback) ⇒ hành động đi `POST …/contracts/:id/approval` cũ
(`platform/flow/adapters/legacy-act.ts`) và dòng thời gian dùng phép chiếu cũ trên thẻ, không yêu cầu `/flow/*`.
- Kịch bản: khi bấm Đạt thì web gửi đúng route hành động flow với task đang mở và dòng thời gian lấy từ GET FlowView [test: e2e/contracts-web/contract-flow.cw.ts » CR-120 · Đạt đi FlowRuntime.act]
- Kịch bản: khi xác nhận kèm SP gắn thì SP đi trong `extension` [test: e2e/contracts-web/products-confirm.cw.ts » cấp 1 sẽ xác nhận ⇒ hộp gắn SP; apps/workspace-web/src/features/contract-approval/lib/approval.test.ts » flowActionOf]
- Kịch bản: khi FlowView của hub không có nhãn phòng thì web điền tên phòng từ /groups [test: apps/workspace-web/src/features/contract-approval/lib/flow-view.test.ts » withGroupLabels]
- Kịch bản: khi Từ chối có lý do thì gửi lý do qua flow và báo đã từ chối [test: e2e/contracts-web/hd3-flow.cw.ts » HD-FR-34 · Từ chối]

## Việc còn lại
- CR-121: xoá `legacy-act.ts`, `flowViewOfApproval`, endpoint `POST …/approval` (sau một bản phát hành).
- Prod: bật khi deploy CR-120 — chỉ khi người dùng xác nhận; kiểm VERSION/migration prod trước.

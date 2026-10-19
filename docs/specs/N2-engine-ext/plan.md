# Plan · N2 engine mở rộng (BE + FE tối thiểu)

## 1. Nối module (app.ts)
- `createApp` dựng hai cầu nối trước mount: `packTools = new PackToolRegistry()` và `packRuns: PackRunsBridge = {}` (khuôn `resolveBridge`).
- `mountProcesses` nhận `packTools` (def + tool driver) và gắn `packRuns.start/cancel` (từ `StartService`/`GateService`). Engine tắt ⇒ cầu rỗng ⇒ gói trả 503 `PROCESS_ENGINE_OFF`.
- `mountPacks` nhận cả hai: gói đăng ký tool + dùng `packRuns`. `mountMcp` nhận `packTools` (+ `PackAccessView`).
- Lớp: `modules/packs/kit/application/{pack-runs,pack-tools}.ports.ts` (kiểu thuần); registry ở `kit/adapters/pack-tools.registry.ts`. `processes` chỉ thấy kiểu cấu trúc (không import `packs`, luật depcruise `pack-*`).

## 2. N2-FR-01 khởi chạy từ gói
`StartService.fromPack(u, req)` = `createFromApi` origin none nhưng **không** `#afterCommit`; trả `{run_id, kick}`. Kit `startPackRun(port, uow, who, req, attach)`: start (tx hub) → `uow.tenant(who, r => attach(r, runId))` (tx gói, `update … set run_id where id and tenant_id and run_id is null`, 0 hàng ⇒ 404) → `kick()`. `attach` lỗi ⇒ `port.cancel(u, runId)` (GateService.cancel, starter được huỷ) rồi ném lại. Thứ tự khoá: tx hub (advisory `process:<tenant>`) COMMIT trước tx gói ⇒ không giữ hai khoá cùng lúc.

## 3. N2-FR-02 Từ chối
`reviewDecisionCheck`: `reject` cần feedback. `RunEvent.review.result` += `reject` ⇒ `end(s,"cancelled")` (luật thuần). `GateService.#review`: reject ⇒ `closeTask(result reject, feedback)` → `threadResult` + `notifier.taskClosed` → `cancelEnd(gx, …, taskId)`; hậu COMMIT `cancelRun` như huỷ. `back_to_step` kèm reject ⇒ bỏ qua (zod cho phép, không nghĩa).

## 4. N2-FR-03 tool gói
- Registry: `register(t)` kiểm `pack` ∉ `_` (khoá tool phải khớp `ProcessKeySchema`), trùng khoá ⇒ ném lúc mount. `catalog(tenantId)` = tool của gói tenant đã bật (`packAccessInput(...).entitled ∧ ¬featureOff`, cache).
- Lưu def: `loadDefRefs` + tool gói của tenant (`ToolDefShape`); mẫu (tenant null) không có tool gói. `editorContext.tools` gộp tool gói.
- Chạy: `loadCallRow` giữ MỘT câu; `toLoad` thấy khoá ∈ registry ⇒ `pack=true`, `sideEffect/inputSchemaOk` từ registry, `switchOn = gói bật cho tenant run`, `wfEnabled = true`. `preCallReason` không đổi ⇒ giữ `usable/canRun/D2-49`. Invoker: `pack` ⇒ `registry.call(key, {tenantId, userId: startedBy, runId}, args, signal)`; lỗi ném ⇒ `failed{code:"UPSTREAM_ERROR", sent: side_effect}`.
- `/mcp`: provider như `kh` — `tools(ctx)` = tool gói ∈ `ctx.tools` ∧ gói bật ∧ user có `read` gói ∧ ¬side_effect; `call` kiểm lại rồi chạy `run` (danh tính user của job).

## 5. N2-FR-04 trần theo tenant
`countActive` → `capOf(tx, tenant)` MỘT câu: `select (select count(*) … cap counted) as n, (select process_runs_max from admin.tenants where id=$t) as max`. `cfg.runsPerTenant` (seam) vắng ⇒ dùng `max` (null ⇒ 5). Admin: `tenants.rules/repo/service` thêm trường như `max_concurrent_sub`; audit theo khuôn có sẵn.

## 6. N2-FR-05 người bắt đầu không duyệt
Luật thuần `starterBlocked(def, startedBy, userId)` (`domain/tasks/task-access.rules.ts`). Gate `#review` sau `lockRun` (snapshot có sẵn, 0 câu thêm) ⇒ 403. `canAct` nhận `starterExcluded` từ `task-view` (snapshot đã đọc).

## 7. FE (admin-web, khuôn có sẵn)
- `TenantInfoForm`: ô số "Trần run quy trình đồng thời" (1…1000) cạnh `max_concurrent_sub`.
- Editor stage review: checkbox "Người bắt đầu không được duyệt bước này" (`exclude_starter`), cạnh `StageRemind`.
- chat-web: nhãn kết quả `reject` ("Từ chối") nơi hiển thị `task_result`.

## 8. Test (viết TRƯỚC code phần quyền/tenant/engine)
`tests/acceptance/N2/`: `cap.int` (AC10), `reject.int` (AC03–05), `starter.int` (AC12–13), `pack-run.int` (AC01–02), `pack-tool.int` (AC06–08), `rules.test` (luật thuần + contract); unit `mcp` provider (AC09), admin tenants int (AC11), unit FE. Hồi quy: P-d, P-b, N1, HD1; perf `d2.perf`.

## Quyết định
| Mã | Quyết định |
|---|---|
| N2-D01 | Từ chối kết thúc run ở trạng thái `cancelled` (không thêm trạng thái run — contract chỉ thêm `TASK_RESULTS`); phân biệt qua task `reject` + feedback |
| N2-D02 | Khoá tool gói `<pack>-<name>` dùng chung trường `tool_key` (không đổi `ToolExecutorSchema`); gói có `_` trong khoá không đăng ký tool được; trùng khoá workflow ⇒ tool gói thắng (registry xét trước) |
| N2-D03 | Tool gói `side_effect` không gọi được qua `/mcp` của agent (không có cổng xác nhận cho gói) — chỉ stage `real_action` sau duyệt |
| N2-D04 | Bản ghi gói gắn run sau COMMIT tx hub, bù bằng huỷ run; kick sau khi gắn |
| N2-D05 | Trần đọc từ `admin.tenants` trong cùng câu đếm (hub_ro đọc sẵn như `timezone`); chỉ platform_admin sửa |
| N2-D06 | `exclude_starter` chỉ chặn task `review` (cấp duyệt), không chặn `decision`/`ask` |
| N2-D07 | `pkdemo` được thêm route mẫu `POST /items/:id/run` (guard `write`, body `{process_key, input, inputs?}`) để khoá hành vi N2-FR-01; item đã có run ⇒ 409 `CONFLICT` trước khi mở run; HD3 làm theo khuôn |
| N2-D08 | `PackRuns.outcomes(u, runIds)` (1 câu, tenant người gọi) trả `{run_id, status, rejected, feedback}` để gói ghi "Bị từ chối" (readiness #1) |
| N2-D09 | Group duyệt chỉ có người bắt đầu ⇒ không chặn lúc lưu def; nhắc/chuyển cấp P-d xử lý |
| N2-D10 | Engine tắt ⇒ `PackRuns` rỗng ⇒ 503 `PROCESS_ENGINE_OFF` (contract `processes-errors.ts`) |
| N2-D11 | Trần = seam `processRunsPerTenant` ?? `admin.tenants.process_runs_max` ?? 5; mount bỏ `?? PROCESS_RUNS_PER_TENANT` |

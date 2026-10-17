# Plan phụ lục · P-d2 backend — stage `tool` + công tắc tool theo tenant + rẽ nhánh (T13)

Phần của [`plan.md`](plan.md) (mục "P-d2" mà `tasks.md` T13 trỏ tới). Nối [spec-d2](spec-d2.md), [spec-tz-tools §2](spec-tz-tools.md), [spec-ca §3, §5–§6](spec-ca.md), ADR-0022. Contract: [plan-contract §6](plan-contract.md); DDL: [plan-db §3–§4](plan-db.md). Bắt đầu sau `done:pd1` (T12); khung UoW/outbox/mapper của P-d1 dùng lại.

## 1. Quyết định (D2)
| # | Quyết định | Lý do (code) |
|---|---|---|
| D2-01 | Stage `tool` chạy bằng **`hub.runs` như stage team** (`prepareProcess` + `createRunTx`, executor `{kind:"tool", workflowId}`, không agent) + driver riêng `toolDriver` | `run_steps.run_id` NOT NULL; usage/trace theo run; cùng đường kick/huỷ/`current_run_id` |
| D2-02 | Gọi Dify qua **cùng pipeline của `/mcp`** — tách `#runTool/#invoke/#startStep/#finishStep/#usage/#guarded` của `McpService` thành `mcp/adapters/workflow-invoker.ts` (`WorkflowInvoker`, không đổi hành vi, T18s); `/mcp` và stage tool cùng gọi. Processes khai port `ToolInvoker`, nối ở lớp 4 (`app.mcp.ts` ⇒ `mountProcesses`) | ADR-0022 #3/#5 (chỉ Hub gọi, ghi token theo khách); `mcp.service.ts` 367 dòng không thêm được; lớp 1–2 không import module khác |
| D2-03 | Bước ghi: `run_steps.type='tool'` (như lời gọi tool của agent), `agent_id = NULL`, `workflow_id`, `detail.inputs` che secret; `usage_logs` qua `recordDifyUsage` cho **người bắt đầu**; cổng xác nhận `side_effect` **bỏ qua** vì gate review đã Đạt (trace `confirmation:"gate_review"`) | PD2-R09, HUB-FR-109; PD-R05 nhận ra "đã gửi" qua D-PD03 |
| D2-04 | Audit công tắc = `entity:"workflow"`, `action:"grant"/"revoke"`, `tenant_id` = tenant (plan §10 Q3) | enum audit admin khoá, mẫu `entitlement` |
| D2-05 | `template_invalid` ở stage tool ⇒ **`needs_decision` ngay** (không tự làm lại) | tự làm lại = gọi tool lần nữa (vi phạm "không gọi lại sau khi gửi") |
| D2-06 | Mẫu (`tenant_id = NULL`) không được chứa stage `tool` ⇒ 422 `PROCESS_REF_INVALID {ref:"tool"}` | công tắc theo tenant; mẫu không có tenant |
| D2-07 | Tham số workflow kiểu `file` ⇒ 422 `TOOL_INVALID` (GĐ1 không truyền file vào tool stage) | `mcp-files` cần attachment của job |
| D2-08 | Bước liền trước của đích có `real_action` khi các bước giữa bị `skipped` ⇒ "bước trước có hiệu lực" = bước gần nhất **không** toàn `skipped` (chính stage rẽ nhánh, PD2-R12 ép là `review`) | HUB-BR-38(b) + `realActionStepCheck` |
| D2-09 | Lỗi "trước khi gửi" = `DifyRunOutcome.failed` ở pha `fetch` (thêm cờ `connectFailed?: true` ở `dify.client.ts` dòng ~171, chỉ thêm) | PD2-R05 phân biệt trước/sau gửi |
| D2-10 | admin-api: module mới `modules/workflow-tools/` bốn lớp; route gắn dưới `/admin/tenants` | spec-ca §6; `tenants/` không phải sửa logic |

## 2. Đặt file P-d2
| Lớp | File | Ghi chú |
|---|---|---|
| 1 | `P/domain/defs/tool-def.rules.ts`, `P/domain/tools/{tool-run,tool-output}.rules.ts`, `P/domain/branch/{branch-def,branch}.rules.ts` | §4 |
| 2 | `P/application/tools/{run-tool-stage,list-tools}.usecase.ts`, `P/application/runs/settle-step.usecase.ts` (T19s), port `ToolInvoker`, `ToolSwitchReader`, `ToolCatalogReader`, `UsageWriter` | |
| 3 | `P/adapters/tools/{mcp-tool-invoker,tool-switch.repo,tool-catalog.repo,tool-driver}.ts`, `P/adapters/runs/hub-settle.ts` (T18s), `P/adapters/branch/branch-effects.ts` | |
| 3 (mcp) | `mcp/adapters/workflow-invoker.ts` (T18s) | `McpService` gọi sang |
| 4 | `processes.mount.ts` (+`toolInvoker`), `app.mcp.ts` (dựng `WorkflowInvoker` dùng chung) | |
| admin | `modules/workflow-tools/{README.md, workflow-tools.mount.ts, domain/{types,errors,toggle.rules}.ts, application/{ports,list-tools.usecase,toggle-tool.usecase}.ts, adapters/{workflow-tools.routes,workflow-tools.repo,workflow-tools.mapper(+test)}.ts}` | `app.ts` gọi mount |
File cũ chỉ lời gọi: `runs/launcher.ts` (nhánh `tool`), `runs/executor-ref.ts` (ref tool = key/tên workflow), `runs/view-steps.ts` (`tool_key`, `skipped`), `defs/def.rules.ts` + `defs.service.ts`, `modules/runs/run-process.ts` (`StageExecutor` + `{kind:"tool"; workflowId}`), `dify/dify.client.ts` (cờ D2-09), `mcp/mcp.repo.ts` (`ToolStepStart.agentId: string | null`).

## 3. Luồng stage `tool`
→ thay bởi plan-addendum A2 (`toolStageIssues`/`branchStageIssues`), plan-addendum A3 (trường Hub ép).
**Lưu def** (`defs.service`, tx tenant): `toolStageIssues` ⇒ `TOOL_INVALID`/`TOOL_SIDE_EFFECT`; `branchStageIssues` ⇒ `BRANCH_INVALID`; ref: `tool_key ∉ toolCatalog.available(tenantId)` (workflow `enabled` ∧ công tắc `revoked_at IS NULL` cho tenant def, đọc DB) hoặc def mẫu ⇒ 422 `PROCESS_REF_INVALID {path:"stages.<i>.executor.tool_key", ref:"tool"}` (không lộ tồn tại). Ép (`ensureToolStage`): `required_sections=["Kết quả","Bàn giao"]`, `template = "# {name}\n\n## Kết quả\n\n## Bàn giao\n"`, `answerer={kind:"starter"}`, `sources=[]`, `must_know=[]`, `autofix=null`, `token_budget=null`; `timeout_s` giữ.
**Chạy** (launcher `plan()`, tx scope user người bắt đầu, run đã khoá; `starterUsable` ⇒ `user_inactive` như cũ; grant chạy quy trình (HUB-BR-27) như cũ ⇒ `permission_lost`): `if (kind==="tool") return launchToolStage(...)` ⇒ `prepareProcess` executor tool ⇒ `createRunTx` ⇒ stage `running`, `current_run_id` ⇒ sau COMMIT `runs.launch(…, {driver: toolDriver})`.
`toolDriver` ⇒ `runToolStageTx(ctx, uow, link)`:
1. `uow.system(run.tenantId)` đọc: snapshot stage, `process_runs.inputs`, output hiện hành các stage nguồn (bước nhỏ hơn), `switch.isOn(workflowId)` + `enabled` (**DB trực tiếp**, `tenant_id = run.tenant_id`, B5/TT-R06/TT-R08). Tắt ⇒ kết thúc với `tool_failed` (không gọi Dify).
2. `buildToolArgs(args, inputs, fields)` ⇒ `{ok:false, missing}` (nguồn `skipped`/không output/không có trường) ⇒ `tool_failed`.
3. **Ngoài tx**: `toolInvoker.call({tenantId, userId: run.startedBy, runId: hubRunId, workflowId, args, timeoutS: stage.timeout_s, signal})` ⇒ `{kind:"ok", text}` hoặc `{kind:"failed", code, httpStatus, sent}`.
4. Tx mới `uow.system(tenantId)`: khoá run → stage `running ∧ current_run_id = hubRunId` (đua huỷ ⇒ bỏ) →
   - `ok`: `byteSize` (adapter `TextEncoder`) > 65 536 ⇒ `tool_failed`; `JSON.parse` lỗi / không object ⇒ `template_invalid` (D2-05); `filterToolFields(result, def.output.fields)` sai kiểu/thiếu bắt buộc ⇒ `template_invalid`; đạt ⇒ `hub-settle.settleDone({md: toolOutputMd(name, fields), fields})` (stage done ⇒ `after.review` mở task / `auto` join), audit `tool_call {status:"ok", ms}`.
   - `failed`: `classifyToolError` + `toolFailureDecision({cls, sideEffect, sent, state})` ⇒ `retry` (hẹn `retry` như plan §4.2, khoá `retry:<stage>:<round>:<attempt>:<n>`) hoặc `decide(tool_failed)`; audit `tool_call {status:"failed", code}`. Không ghi giá trị tham số/kết quả vào audit.
5. Sau COMMIT: outbox (kick/process_updated/thread); `hub.runs` kết thúc (`finished`/`failed`).
`decisionOptionsFor(hasOutput, "tool_failed")`: `use_current` chỉ khi có output hiện hành. `add_attempt` ⇒ attempt+1 ⇒ gọi lại (người quyết chủ động — không vi phạm "không tự gọi lại").
**Catalog editor**: `GET /process-editor/context` trả thêm `tools = listTools(tenantId)` = workflow `enabled` ∧ công tắc bật (TT-R04), map `ProcessToolItemSchema` (tham số từ `workflows.input_schema`). Mẫu (tenant null) ⇒ `tools: []`.

## 4. Chữ ký luật P-d2 (qc test trước; kiểu domain tự khai)
→ thay bởi plan-addendum A2, A3 khi lệch.
```ts
// domain/defs/tool-def.rules.ts
export type ToolDefShape = { key: string; sideEffect: boolean; params: readonly { name: string; type: string; required: boolean }[] };
/** TOOL_INVALID: >20 tham số | thiếu tham số required | tên tham số ∉ params | param type "file" | nguồn input không có |
 *  nguồn field: stage_key không ở bước nhỏ hơn / field không khai | stage có sources/must_know/autofix | answerer≠starter (sau ép).
 *  TOOL_SIDE_EFFECT: tool.sideEffect ∧ ¬realAction. Path `stages.<i>.executor` / `.executor.args.<name>`. Tool không khả dụng ⇒ adapter. */
export function toolStageIssues(stages: readonly (StageShape & { tool: { toolKey: string; args: Readonly<Record<string, ArgSource>> } | null })[],
  inputs: readonly InputShape[], tools: ReadonlyMap<string, ToolDefShape>): DefIssue[];
// domain/tools/tool-run.rules.ts
export type ArgSource = { from: "input"; key: string } | { from: "field"; stageKey: string; field: string }
  | { from: "const"; value: string | number | boolean };
export function buildToolArgs(args: Readonly<Record<string, ArgSource>>, inputs: ReadonlyMap<string, string>,
  fields: ReadonlyMap<string, Readonly<Record<string, string | number>> | null>):
  { ok: true; values: Record<string, string | number | boolean> } | { ok: false; missing: string };
export type ToolFailure = { code: string; httpStatus: number | null; sent: boolean; reason: "upstream" | "invalid_output" | null };
/** chưa gửi ∧ (UPSTREAM_ERROR|TIMEOUT) ⇒ transient; đã gửi: TIMEOUT | UPSTREAM_ERROR với http null/≥500/408/429 ⇒ transient;
 *  4xx khác | NOT_CONFIGURED | INVALID_ARGS | invalid_output | lạ ⇒ business. */
export function classifyToolError(f: ToolFailure): JobErrorClass;
/** business ⇒ decide(tool_failed); transient ∧ sideEffect ∧ sent ⇒ decide(tool_failed); transient ∧ hết lượt ⇒
 *  decide(retry_exhausted); còn lại ⇒ retry (dùng decideRetry với sideEffectSent = sideEffect ∧ sent). */
export function toolFailureDecision(i: { f: ToolFailure; sideEffect: boolean; state: RetryState; now: Date }): RetryDecision;
// domain/tools/tool-output.rules.ts
export function filterToolFields(result: unknown, decl: StageShape["fields"]):
  { ok: true; fields: Record<string, string | number> } | { ok: false; why: "not_object" | "missing" | "type" };
export function toolOutputMd(stageName: string, fields: Readonly<Record<string, string | number>>): string;
// = "# {name}\n\n## Kết quả\n| Trường | Giá trị |\n|---|---|\n…\n\n## Bàn giao\nĐã gọi tool; trường: {k1, k2…}\n\n```fields\n{json}\n```\n" (Bàn giao ≤ 200 token qua clipHandoff)
// domain/branch/branch-def.rules.ts
export type BranchRule = { field: string; op: "eq" | "ne" | "lt" | "le" | "gt" | "ge"; value: string | number; gotoStep: number };
/** BRANCH_INVALID: > 10 luật | stage không đứng một mình trong bước | field ∉ output.fields | lt…ge với string |
 *  value khác kiểu (date: ISO + ngày lịch) | gotoStep ≤ step | gotoStep ≥ số bước | đích có realAction ∧ after≠review. */
export function branchStageIssues(stages: readonly (StageShape & { branch: readonly BranchRule[] })[]): DefIssue[];
// domain/branch/branch.rules.ts
/** Luật đầu tiên khớp (trường vắng ⇒ không khớp; date so chuỗi YYYY-MM-DD) ⇒ {goto, rule (1-based)}; không ⇒ null. */
export function evaluateBranch(rules: readonly BranchRule[], fields: Readonly<Record<string, string | number>> | null):
  { gotoStep: number; rule: number } | null;
export function skippedStages(steps: readonly number[], fromStep: number, gotoStep: number): number[];   // idx bước (from, goto)
/** Bước "liền trước có hiệu lực" của `step` (bỏ qua bước mà mọi stage skipped) — D2-08. */
export function effectivePrevStep(stepStatuses: ReadonlyMap<number, readonly StageRunStatus[]>, step: number): number | null;
```
`StageRunStatus`/`DecisionReason`/`ExecutorKind` domain thêm `skipped`/`tool_failed`/`tool` ở T17 (mapper test đỏ tới khi khớp).

## 5. Công tắc tool — admin-api `modules/workflow-tools` (T18a)
| Lớp | Nội dung |
|---|---|
| domain | `type ToolSwitch = { workflowId; tenantId; on: boolean; grantedAt: Date \| null; grantedBy: string \| null }`; `toggle.rules.ts`: `toggleChange(cur: { revokedAt: Date \| null } \| null, want: "on" \| "off"): "insert" \| "reactivate" \| "revoke" \| "none"` |
| application | `ports.ts`: `WorkflowToolsRepo.{list(tenantId), get(tenantId, workflowId), insert, reactivate, revoke}`, `ConfigTx` (`write(fn(r, sink))` — sink = `changed` + `audit`); `toggle-tool.usecase.ts`: tenant/workflow tồn tại ⇒ `toggleChange` ⇒ ghi + `sink.changed({entity:"workflow", tenantId})` + `sink.audit(grant/revoke)` chỉ khi đổi; `list-tools.usecase.ts` |
| adapters | `workflow-tools.repo.ts` (Drizzle, `withScope` platform), `workflow-tools.mapper.ts` (+test khớp `TenantWorkflowToolSchema`), `workflow-tools.routes.ts` (≤ 30 dòng/handler, `requireAuth` + `requireRole("platform_admin")`, `parseIdParam`) |
| mount | `ConfigTx` bằng `configWrite` (`lib/config/config-write.ts`) — NOTIFY sau COMMIT sẵn có |
Bật lại = `revoked_at = NULL, granted_by = actor, granted_at = now`. 404 khi tenant/workflow không có (`NOT_FOUND`).

## 6. Rẽ nhánh (T19)
Điểm đánh giá: `settleStep` (dời `application/runs/settle-step.usecase.ts`, T19s) khi stage chốt `done` (Đạt hoặc `auto`) ∧ `after.branch.length > 0`: `evaluateBranch(rules, currentOutput.fields)` ⇒ khớp ⇒ trong **cùng tx join**: `skippedStages` ⇒ `UPDATE stage_runs SET status='skipped', finished_at=$now WHERE tenant_id AND process_run_id AND stage_idx = ANY` (chỉ stage `pending`), `cancelTimers(stageIds)`, `current_step = goto_step`, `current_stage_idx = firstIdxOfStep(goto)`, stage bước đích ⇒ `queued`; thread `branch {stage_idx, to_step: goto, rule}` (câu FE "Rẽ nhánh: tới bước {goto+1} (luật {n})"), audit `branch` (entity `process_run`, actor hệ thống, `details {from_step, to_step, rule}`); không khớp ⇒ `stepJoin` như cũ. `stepJoin`/`runStatusOf`: `skipped` = xong. Quay lại (`backResetPlan`, domain/gates): stage `skipped` ⇒ `pending`, `round` **không** tăng (chưa từng chạy, PB2-R07). `realActionStepCheck` gọi với stage của `effectivePrevStep` (D2-08).

## 7. Bảo mật P-d2 (security review T20 — hard stop)
| # | Kiểm |
|---|---|
| T1 | Danh tính gọi tool = **người bắt đầu** (`difyUser(tenantKey(run.tenant_id), run.started_by)`), không token job/agent; `tenantKey` lấy theo `run.tenant_id` |
| T2 | Công tắc + `enabled` đọc DB lúc **lưu** (tenant def) và **ngay trước gọi** (tenant run) — `WHERE workflow_id=$w AND tenant_id=$runTenant AND revoked_at IS NULL`; không cache; tắt giữa chừng ⇒ `tool_failed`, Dify không được gọi (AC-H47) |
| T3 | Chỉ workflow catalog Hub (không URL người dùng) ⇒ không SSRF mới; `base_url` lấy từ catalog |
| T4 | `side_effect` chỉ ở stage `real_action` (gate review Đạt); không tự gọi lại sau khi gửi; `template_invalid` không tự làm lại (D2-05) |
| T5 | Audit/trace không chứa giá trị tham số/kết quả (che bằng `maskInputs`, cắt) |
| T6 | Endpoint catalog editor chỉ trả tool của tenant người gọi (`defScopeOf`); tenant khác ⇒ không thấy |
| T7 | admin: route chỉ `platform_admin`; `admin_rw` scope tenant B không thấy hàng A (RLS); `hub_ro` chỉ SELECT |
| T8 | `WorkflowInvoker` tách ra không đổi luật `/mcp` (agent vẫn qua cổng xác nhận `side_effect`) — so test `/mcp` cũ xanh |

## 8. Tách file cũ P-d2
| Task | File cũ → đích | qc sửa |
|---|---|---|
| T18s | `mcp/mcp.service.ts` (pipeline gọi Dify) → `mcp/adapters/workflow-invoker.ts` | test `/mcp` khoá nạp `McpService` (giữ public API ⇒ có thể không đổi; qc grep `mcp.service`) |
| T18s | `runs/apply-settle.ts` (`writeApplyOutput`, `settleApply`) → `P/adapters/runs/hub-settle.ts` (+ tham số `fields?`) | P-c2 test nạp `apply-settle` (nếu có) |
| T19s | `core/step.rules.ts` đã dời ở T8s (plan-domain §7) ⇒ T19 sửa tại `domain/runs/step.rules.ts`; `runs/step-persist.ts` (`settleStep`) → `application/runs/settle-step.usecase.ts` + `adapters/runs/step.repo.ts` | `P-b2/**` nạp `step-persist` |

## 9. Ước lượng + thứ tự P-d2
| Task | Diff | Rủi ro |
|---|---|---|
| T17 contract + 0037 | ~170 (+SQL ~70) | cao · Opus |
| T18a công tắc admin | ~330 | cao · Opus |
| T18s | ~250 | cao · Opus |
| T18 executor tool | ~400 ⇒ chia **T18-1** (lưu def + catalog + launcher + driver đọc công tắc) / **T18-2** (gọi + kết quả + lỗi/thử lại + audit) | cao · Opus |
| T19s / T19 | ~150 / ~300 | cao · Opus |
Thứ tự: T17 → T18a ∥ T18s → T18-1 → T18-2 → T19s → T19 → T20.

## 10. Khép readiness P-d2
#6 ⇒ thay bằng công tắc (§3, §5, §7) · #7 ⇒ §3 ép trường · #8 ⇒ ExecutorRef tool = `{kind:"tool", key: tool_key, name:{vi,en: tên workflow}}` · #12 ⇒ plan-db §3 · #13 ⇒ §3 ref `tool` · #14 ⇒ §3 `tool_failed` cần output · #15 ⇒ `buildToolArgs` nguồn bước nhỏ hơn · #26 ⇒ D2-01/D2-03. Câu hỏi riêng P-d2: không có ngoài plan §10 Q3.

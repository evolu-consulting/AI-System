# Plan · P-d2 backend — stage `tool` + công tắc tool theo tenant + rẽ nhánh

Phần P-d2 của [`plan.md`](plan.md). Nối [spec-d2](spec-d2.md), [spec-tz-tools §2](spec-tz-tools.md), [spec-ca §3, §5–§6](spec-ca.md). Contract: [plan-contract §6](plan-contract.md), hàm contract + path lỗi: [plan-addendum A2](plan-addendum.md), trường ép: A3; DDL: [plan-db §3–§4](plan-db.md). Quyết định: [`spec-decisions.md`](spec-decisions.md) mục "P-d2" (D2-01…D2-18, D2-24…D2-39).
## 0. Lệch so với code P-d1 (T13; L1–L4, L8, L9, L11, L12 đã thành D2-11…D2-13 và §2–§4, §10)
| # | Code P-d1 thật (bản đầu giả định khác) | Sửa |
|---|---|---|
| L5 | `validateProcessDef` gom `processDefStageIssues` + `teamSectionIssues`, cắt 20 | Gom thêm `toolStageIssues`/`branchStageIssues`; ref tool qua `DefRefs.tools` (D2-14) |
| L6 | `settleStep(tx, runId, tenantId)` (`runs/step-persist.ts`), 7 nơi gọi | Nhánh chèn **một chỗ**: `stepJoin → next_step` (§7) |
| L7 | Kick chỉ kiểm `starterUsable` + grant agent/nhóm, không kiểm `run_group_ids` | Câu đọc trước gọi tool kiểm `canRun` (PD2-R03, D2-15) |
| L10 | `McpService.#timeoutS` theo agent của job | `timeoutS = min(stage.timeout_s, HUB_DIFY_TIMEOUT_MAX_S)` |

## 1. Quyết định + khép readiness
D2-01…D2-39: [`spec-decisions.md`](spec-decisions.md) "P-d2" (câu hỏi mở T13 = D2-24…D2-28; readiness lần 1 P-d2 = D2-29…D2-34, D2-39; Q-T14 = D2-35…D2-38). Readiness: #6 ⇒ §4, §6 · #7 ⇒ A3 · #8 ⇒ ref `{kind:"tool", key, name: tên workflow}` · #12 ⇒ plan-db §3 · #13 ⇒ §4 · #14, #15 ⇒ plan-d2-rules · #26 ⇒ D2-01/03.

## 2. Đặt file (P = `apps/hub-api/src/modules/processes`)
| Lớp | File mới | Ghi chú |
|---|---|---|
| 0 | `P/domain/index.ts`, `P/application/index.ts` (barrel, chỉ re-export; test nạp qua đây) | T17 |
| 1 | `P/domain/defs/tool-def.rules.ts`, `P/domain/tools/{tool-run,tool-output}.rules.ts`, `P/domain/branch/{branch-def,branch}.rules.ts` | §5 |
| 2 | `P/application/tools/{tool.ports,run-tool-stage.usecase,handle-tool-failure.usecase,list-tools.usecase}.ts`; `P/application/runs/settle-step.usecase.ts` (T19s) | `ports.ts` chỉ thêm `TxRepos.tools` + `steps` |
| 3 | `P/adapters/tools/{tool-stage.repo,tool-switch.repo,tool-launch,tool-driver,mcp-tool-invoker}.ts`; `P/adapters/runs/{hub-settle,step.repo}.ts` (T18s/T19s) | |
| 3 mcp | `mcp/adapters/workflow-invoker.ts` (T18s, `McpService` gọi sang) | |
| 4 | `processes.mount.ts` (dựng `toolDriver` + truyền factory cho launcher), `app.mcp.ts` (một `WorkflowInvoker` dùng chung) | |
| admin | `apps/admin-api/src/modules/workflow-tools/` bốn lớp (§6) | `app.ts` gọi mount |

**File cũ chỉ thêm lời gọi:** `runs/launcher.ts` (nhánh `tool` sau `apply`), `runs/executor-ref.ts`, `runs/view-steps.ts` (`tool_key`, `skipped`), `defs/{def.rules,teams.repo,defs.service}.ts` (`DefRefs.tools`, `editorContext.tools`, `ensureToolStage`), `modules/runs/run-process.ts` (`StageExecutor` + `{kind:"tool"; workflowId}`), `dify/dify.client.ts` (`connectFailed`, D2-09), `mcp/mcp.repo.ts` (`agentId: string | null`; cột đã nullable), `handle-job-failure.usecase.ts` (tách `scheduleRetry`).

## 3. Cổng (lớp 2, không `Tx`)
```ts
// application/tools/tool.ports.ts — TxRepos thêm `tools: ToolStageRepo` (bindTx dựng, lọc tenant UoW)
export type ToolCallLoad = { stageName: string; toolKey: string; workflowId: string; sideEffect: boolean;
  timeoutS: number; args: Readonly<Record<string, ArgSource>>; outputFields: FieldDecl[];
  inputs: ReadonlyMap<string, string>; inputTypes: ReadonlyMap<string, string>; fields: ReadonlyMap<string, Readonly<Record<string, string | number>> | null>;
  startedBy: string; usable: boolean; canRun: boolean; switchOn: boolean; wfEnabled: boolean; state: RetryState };
export type ToolStageRepo = {
  /** MỘT câu: stage running của hubRunId + snapshot + inputs + fields nguồn + công tắc/enabled + usable/canRun. */
  loadCall(runId: string, stageRunId: string, hubRunId: string): Promise<ToolCallLoad | null>;
  /** Sau `runs.lock`: `for update` stage còn `running ∧ current_run_id = hubRunId`; false ⇒ bỏ (đua). */
  lockRunning(stageRunId: string, hubRunId: string): Promise<boolean>;
  /** Output (.md + fields) rồi đường hậu-output như agent (§4 bước 4); kick/thread vào outbox. */
  settleOk(x: { runId: string; stageRunId: string; md: string; fields: Record<string, string | number> }, now: Date): Promise<void>;
  decide(x: { runId: string; stageRunId: string; reason: ToolDecisionReason }, now: Date): Promise<void>;
  audit(x: { runId: string; stageRunId: string; toolKey: string; status: "ok" | "failed"; code: string | null; ms: number }): Promise<void>;
};
export type ToolDecisionReason = "tool_failed" | "template_invalid" | "retry_exhausted" | "permission_lost" | "user_inactive";
export type ToolCallResult = { kind: "ok"; text: string } | { kind: "failed"; code: string; httpStatus: number | null; sent: boolean };
/** Nối lớp 4 tới `WorkflowInvoker` (cùng pipeline `/mcp`: key → bước `tool` → Dify gom → usage). */
export type ToolInvoker = { call(c: { tenantId: string; userId: string; hubRunId: string; workflowId: string;
  args: Record<string, string | number | boolean>; timeoutS: number; signal?: AbortSignal }): Promise<ToolCallResult> };
/** Tool khả dụng của tenant (TT-R04) — adapter scope user (editor) / tx def (lưu). `keys` vắng ⇒ tất cả (≤ 200). */
export type ToolSwitchReader = { available(keys?: readonly string[]): Promise<ToolDefShape[]> };
// StepRepo (T19s, settle-step.usecase): loadJoin(runId) · queueStep(idxs, step) · finish(first) · setStatus(status, first)
//   + T19: currentFields(stageIdx) · skipStages(idxs, now) ⇒ stageRunIds · branchEvent({stageIdx, toStep, rule})
```
`run-tool-stage.usecase.ts`: `runToolStage(d: { uow: Pick<SystemUow,"system">; invoker: ToolInvoker; clock: Clock }, link)` — tx1 `loadCall` → luật (`buildToolArgs`) → **ngoài tx** `invoker.call` → tx2 `runs.lock` → `tools.lockRunning` → `settleOk` / `handleToolFailure` / `decide` + `audit`.

## 4. Luồng stage `tool`
**Lưu def** (`defs.service.#check`, tx def): `loadDefRefs(tx, tenantId, toolKeys)` thêm `tools: Map<key, ToolDefShape>` = **một câu** chỉ khi def có stage `tool` (§9). `validateProcessDef` gom `toolStageIssues` + `branchStageIssues` (domain, sau mapper) vào danh sách INVALID (cắt 20, path A2) ⇒ `PROCESS_DEF_INVALID`; nguồn không hợp kiểu tham số (`paramCompatible`, [rules §2](plan-d2-rules.md)) ⇒ `TOOL_INVALID` path `stages.<i>.executor.args.<name>` (D2-29); `stageRefMiss`: `tool_key ∉ refs.tools` hoặc def mẫu ⇒ `PROCESS_REF_INVALID {path:"stages.<i>.executor.tool_key", ref:"tool"}` (`RefKind` + `"tool"`). Ép `ensureToolStage` (A3) cạnh `withHandoff`.
**Launch** (`launcher.plan`, tx scope user người bắt đầu, run đã `FOR UPDATE`; sau `starterUsable` ⇒ `user_inactive` như cũ): `kind==="tool"` ⇒ `adapters/tools/tool-launch.launchToolStage` = `prepareProcess` executor `{kind:"tool", workflowId}` (không agent, như nhóm) ⇒ `createRunTx` ⇒ stage `running` + `markLaunched` ⇒ `{kind:"launch"}`; `kickOnce` gọi `runs.launch(…, {driver: d.toolDriver})` (factory từ mount, L2).
**Driver** (`tool-driver.ts`, bọc `drain.track`): gọi `runToolStage`:
1. tx1 `uow.system(run.tenantId)` → `loadCall`. `null` ⇒ thôi. `!usable` ⇒ `decide(user_inactive)`; `!canRun` ⇒ `permission_lost`; `!switchOn ∨ !wfEnabled` ⇒ `tool_failed` (TT-R06/R07, Dify **không** được gọi).
2. `buildToolArgs` (input kiểu `number` ⇒ `Number`, nhờ `inputTypes`, D2-29); lỗi (nguồn `skipped`/thiếu) ⇒ `decide(tool_failed)`.
3. Ngoài tx: `invoker.call` (tham số `confirmation:"gate_review"` vào trace, D2-03; không qua `SideEffectGate`).
4. tx2: `runs.lock` → `lockRunning` (false ⇒ bỏ kết quả) →
   - `ok`: `byteSize > TOOL_RESULT_MAX_BYTES` ⇒ `tool_failed` (kiểm **trước** `JSON.parse`); parse lỗi / `filterToolFields` sai ⇒ `template_invalid` (D2-05); đạt ⇒ `settleOk({md: toolOutputMd(…), fields})` = đường hậu-output của stage agent (D2-30): `after.review` ⇒ `waiting_review` + review task (nhắc/chuyển cấp P-d1), khi Đạt ⇒ nhánh §7; `auto` ⇒ `done` + join.
   - `failed`: `handleToolFailure` = `toolFailureDecision` (`sent` lấy từ kết quả gọi, không dò `run_steps`) ⇒ `retry` ⇒ `retry.markWaiting` + `timers.insert` (khoá `timerKey` như agent) ; `decide` ⇒ `decide(reason)`.
   - luôn `audit` (không giá trị tham số/kết quả).
5. Sau COMMIT: outbox (kick / `post_thread` / `user_events`) + `hub.runs` kết thúc.
Hẹn `retry` bắn ⇒ `fire-timer` ⇒ `requeue` ⇒ kick ⇒ launch lại ⇒ bước 1 đọc công tắc lại (TT-R07). `add_attempt` của `tool_failed` ⇒ attempt+1 (D-PD04).
**Catalog editor**: `editorContext(tenantId)` thêm `tools = list-tools.usecase(ToolSwitchReader)` (tenant null ⇒ `[]`), map `ProcessToolItemSchema` (A1).

## 5. Chữ ký luật lớp 1
→ [plan-d2-rules.md §1](plan-d2-rules.md) (`tool-def`, `tool-run`, `tool-output`, `branch-def`, `branch`). Domain `StageRunStatus`/`DecisionReason`/`ExecutorKind` thêm `skipped`/`tool_failed`/`tool` ở T17; `stepJoin`/`runStatusOf`: `skipped` = xong.

## 6. Công tắc tool — admin-api `modules/workflow-tools` (T18a, D2-10)
| Lớp | Nội dung |
|---|---|
| domain | `ToolSwitch = { workflowId; tenantId; on; grantedAt: Date \| null; grantedBy: string \| null }`; `toggleChange(cur: { revokedAt: Date \| null } \| null, want: "on" \| "off"): "insert" \| "reactivate" \| "revoke" \| "none"` |
| application | `ports.ts`: `WorkflowToolsRepo.{list(tenantId), lockOne(tenantId, workflowId), insert, reactivate, revoke}`, `ConfigTx.write(fn(r, sink))` (sink = `changed` + `audit`); `toggle-tool.usecase`: tenant + workflow tồn tại (404 `NOT_FOUND`) ⇒ `toggleChange` ⇒ ghi + `changed({entity:"workflow", tenantId})` + audit grant/revoke **chỉ khi đổi**; `list-tools.usecase` |
| adapters | `workflow-tools.repo.ts` (Drizzle, `withScope` platform), `workflow-tools.mapper.ts` (+test khớp `TenantWorkflowToolSchema`), `workflow-tools.routes.ts` (`requireAuth` + `requireRole("platform_admin")`, `parseIdParam`) |
| mount | `ConfigTx` = `configWrite` (`lib/config/config-write.ts`, NOTIFY sau COMMIT) |

DDL/RLS: plan-db §4 (`0012`, RLS như 0004: `admin_rw` theo tenant, `hub_ro` SELECT). Bật lại = `revoked_at = NULL, granted_by = actor, granted_at = now`.

## 7. Rẽ nhánh — nối `settleStep` (T19s ⇒ T19)
T19s dời `settleStep` sang `application/runs/settle-step.usecase.ts` (port `StepRepo`, §3) + `adapters/runs/step.repo.ts`; giữ hàm vỏ `settleStepTx(tx, runId, tenantId)` cùng chữ ký ⇒ 7 nơi gọi không đổi. T19 chèn **một chỗ**: `stepJoin` cho `next_step` ∧ bước hiện tại có đúng một stage ∧ `after.branch.length > 0` (đọc từ snapshot đã nạp) ⇒ `currentFields` ⇒ `evaluateBranch` ⇒ khớp: `skipStages(skippedStages(…))` (chỉ `pending`/`queued` ⇒ `skipped`, `finished_at = now`) ⇒ `timers.cancelForRun(runId, ids, now)` ⇒ `queueStep(goto)` (`current_step = goto`, `current_stage_idx = first(goto)`) ⇒ `branchEvent` (thread `branch {stage_idx, to_step, rule}` + audit `branch` actor hệ thống, `details {from_step, to_step, rule}`); không khớp ⇒ `queueStep(next)` như cũ. Mọi đường chốt `done` (gate Đạt, `auto`, `wait_until`, tool `auto` hoặc tool `review` khi Đạt, người cho qua) đều đi qua đây. Quay lại (`domain/gates/back.rules.ts`): `skipped` ⇒ `pending`, `round` không tăng (PB2-R07); `realActionStepCheck` dùng `effectivePrevStep` (D2-08).

## 8. Thứ tự khoá + transaction
| Tx | Khoá (theo thứ tự) | Ghi |
|---|---|---|
| launch (scope user) | `process_runs` FOR UPDATE → `stage_runs` (UPDATE) → `hub.runs` INSERT | như stage agent |
| tx1 driver (system) | không khoá (chỉ đọc) | — |
| gọi tool | **không giữ tx/khoá** trong lúc gọi mạng | bước `tool` + usage: tx ngắn riêng của `WorkflowInvoker` (như `/mcp`) |
| tx2 driver (system) | run FOR UPDATE → stage FOR UPDATE → `process_timers` → (không team) | output, stage, join/nhánh, audit, thread event |
| nhánh (trong tx đang giữ run) | run (đã giữ) → `stage_runs` bị nhảy → `process_timers` của chúng | — |
| admin toggle | hàng `tenant_workflow_tools` FOR UPDATE (hoặc INSERT) | audit + `config_version` |

`lockEventRun` (FOR SHARE run → rooms) sau COMMIT — không đổi. Vòng lô không chạm stage `tool`. 40P01/40001 ⇒ chạy lại tx2.

## 9. Thiết kế hiệu năng (Luật 4c)
| Đường | Số câu SQL (cố định) | Index | Ngưỡng (`*.perf.int.test.ts`, qc T15) |
|---|---|---|---|
| Lưu def có stage tool | +1 câu so với hiện tại (0 khi không có stage tool): `workflows w join tenant_workflow_tools t on (t.workflow_id = w.id and t.tenant_id = $t and t.revoked_at is null) where w.enabled and w.key = any($keys)` | `workflows_key_uq`, PK `(workflow_id, tenant_id)` | **PD2-P01** PUT def 30 stage / 10 tool, p95 ≤ 50 ms và ≤ trước + 5 ms (đo trước ở đầu T18-1, bản không tool) |
| Catalog editor | `editorContext` = 2 câu (múi giờ + tools, `limit 200`, văn bản cố định) | index một phần `(tenant_id, workflow_id) where revoked_at is null` | **PD2-P02** 200 workflow × 50 tenant (10.000 hàng công tắc), p95 ≤ 20 ms |
| Một stage tool (Hub, Dify giả trả ngay) | launch như agent; tx1 = 1 câu; invoker = 4 câu (key, mở bước, đóng bước, usage — giữ `/mcp`); tx2 ≤ 9 câu (2 khoá, output, stage, kh, join 2, audit, thread) ⇒ **≤ 14 câu ngoài launch** (đếm từ trước `jobDone` s0, chỉ tx của driver), không phụ thuộc số tham số/stage nguồn | `stage_runs(process_run_id)`, `process_outputs` PK | **PD2-P03** đếm câu = hằng (1 vs 20 tham số); phần Hub p95 ≤ 60 ms |
| Nhánh | So với def **không `branch`**: khớp **+4** (fields, UPDATE `stage_idx = any`, huỷ hẹn `stage_run_id = any`, audit+thread 1 câu `insert … select`), không khớp **+1** (chỉ đọc `fields`) — dù nhảy bao nhiêu bước | `stage_runs(process_run_id)`, `process_timers` mở theo stage | **PD2-P04** nhảy 1 vs 18 bước: số câu bằng nhau; p95 ≤ 30 ms cho khoảng đo = `POST decision` Đạt + `settled()` |
| Toggle admin | 3 câu (lock/insert, audit, bump version) | PK | p95 ≤ 30 ms (int) |
| Danh sách run admin (T17b) | +1 câu theo tập cho cả trang (`process_timers`/`stage_runs` lọc `= any(ids)`, văn bản cố định), không câu theo run | `process_timers`, `stage_runs(process_run_id)` | **PD2-P05** trang 50 run: số câu bằng nhau với 1 vs 50 run có hẹn; p95 ≤ 40 ms và ≤ trước + 5 ms (đo trước ở đầu T17b) (D2-32) |

Không vòng hàng (fields nguồn một câu `stage_key = any`); không gọi mạng trong tx; không sleep/poll (test chờ `handles.settled()`); không cache công tắc (TT-R06).

## 10. Bảo mật (security review T20 — hard stop)
| # | Kiểm |
|---|---|
| S1 | Danh tính gọi = **người bắt đầu** (`difyUser(tenantKeyOf(catalog, run.tenant_id), run.started_by)`), không token job/agent |
| S2 | Công tắc + `enabled` đọc DB lúc **lưu** và **ngay trước gọi**, `tenant_id = run.tenant_id`; tắt ⇒ `tool_failed`, Dify 0 lời gọi (AC-H47) |
| S3 | Chỉ workflow catalog Hub, `base_url` từ catalog ⇒ không SSRF mới |
| S4 | `side_effect` chỉ ở stage `real_action` (gate Đạt); không tự gọi lại sau khi gửi; `template_invalid` không tự làm lại |
| S5 | Audit/trace không chứa giá trị tham số/kết quả (`maskInputs`, cắt) |
| S6 | Catalog editor chỉ tool của tenant theo `defScopeOf` (tenant_admin chỉ tenant mình) |
| S7 | admin: route chỉ `platform_admin`; `admin_rw` scope tenant B không thấy hàng A |
| S8 | `WorkflowInvoker` tách không đổi luật `/mcp` (agent vẫn qua cổng `side_effect`) — test `/mcp` cũ xanh |
| S9 | `hub_ro` policy `USING (true)` ⇒ mọi câu Hub đọc công tắc PHẢI lọc `tenant_id`; int 2 tenant (bật ở B, chạy ở A ⇒ `tool_failed`) |
| S10 | Kiểm Group chạy quy trình (`canRun`) + `usable` ngay trước gọi (L7) |
| S11 | `toolDriver` giữ `SystemUow` trong closure của mount; launcher/route không thấy (`uow-boundary.test` xanh) |
| S12 | Giới hạn 64 KB kiểm trên byte **trước** `JSON.parse` (chống tốn bộ nhớ) |

## 11. Tách file cũ + ước lượng + thứ tự
| Task | Việc | Diff | Rủi ro |
|---|---|---|---|
| T17 | contract + 0037 + barrel + notice chuyển cấp (trường optional cuối, Hub notifier/mapper; không DDL) | ~230 (+SQL ~70) | cao |
| T17b | `ProcessRunSummary` wait/retry: 1 câu theo tập mỗi trang + PD2-P05 | ~120 | cao |
| T18a | công tắc admin (§6) + 0012 | ~330 | cao |
| T18s | `mcp.service` pipeline → `mcp/adapters/workflow-invoker.ts`; `runs/apply-settle` (`writeApplyOutput`, `settleApply`) → `P/adapters/runs/hub-settle.ts` (+`fields?`); tách `scheduleRetry`. qc grep `mcp.service`/`apply-settle` | ~250 | cao |
| T18-1 | lưu def + catalog + `tool-launch` + driver tx1 (đọc công tắc/quyền) | ~220 | cao |
| T18-2 | invoker + tx2 + lỗi/thử lại + audit + PD2-P03 | ~220 | cao |
| T19s | `settleStep` → use case + `step.repo` (qc: `P-b2/**` nạp `step-persist`) | ~150 | cao |
| T19 | nhánh + `skipped` + back + PD2-P04 | ~300 | cao |
Thứ tự: T15c (qc, trước Gate) → T17 → T17b ∥ T18a ∥ T18s → T18-1 → T18-2 → T19s → T19 → T20. **Đo trước khi sửa** (số câu + p95, ghi vào hàng task ở "Quyết định trong lúc làm"): T18s một lời gọi `/mcp` (H2a); T18-1 PD2-P01; T19s POST Đạt + `settled()` def 5 bước không `branch`; T17b PD2-P05 (D2-31).

## 12. Câu hỏi mở
Q-T13-1…5 (canRun chỉ stage `tool`; ngưỡng P01…P04; catalog limit 200; giữ 4 câu/lời gọi `/mcp`; ADR-0022 Proposed ⇒ dùng pipeline `/mcp`) đã chuyển thành D2-24…D2-28 ở [spec-decisions.md](spec-decisions.md).

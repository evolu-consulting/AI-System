# Plan phụ lục · Bổ sung sau readiness lần 2 (backend-lead) — G1–G7, #37, #46, #47

Phần của [`plan.md`](plan.md) (plan.md/plan-frontend.md sát trần ⇒ mọi phần thêm ở đây). Nối [plan-contract](plan-contract.md), [plan-domain](plan-domain.md), [plan-d2](plan-d2.md), [readiness lần 2](readiness.md). Mục này **thắng** chỗ khác khi lệch (ghi rõ dòng nào bị thay). Đối chiếu code `platform/gd0` 2026-10-17.

## A1. G1 — `ProcessToolItemSchema.params[]` (thay khối `params` ở plan-contract §6)
File `packages/contracts/src/hub-admin/process-tools.ts` (mới, `hub-admin/processes.ts` thêm `export * from "./process-tools"`; file này chỉ `import type` từ `./processes` ⇒ không vòng import lúc chạy).
```ts
import { INPUT_DESC_MAX, INPUT_NAME_RE, INPUT_SCHEMA_MAX, InputTypeSchema, SELECT_OPTION_MAX, SELECT_OPTIONS_MAX } from "../common";
export const ProcessToolParamSchema = z.strictObject({
  name: z.string().regex(INPUT_NAME_RE),
  type: InputTypeSchema,                                                    // = WorkflowInput.type
  required: z.boolean(),
  description: z.string().max(INPUT_DESC_MAX).optional(),                   // ≤ 400 — workflows.input_schema[].description
  options: z.array(z.string().min(1).max(SELECT_OPTION_MAX)).max(SELECT_OPTIONS_MAX).optional(), // ≤ 50 — chỉ type "select"
});
export type ProcessToolParam = z.infer<typeof ProcessToolParamSchema>;
export const ProcessToolItemSchema = z.strictObject({
  key: ProcessKeySchema, name: z.string().min(1).max(128), description: z.string().max(400),
  side_effect: z.boolean(),
  params: z.array(ProcessToolParamSchema).max(INPUT_SCHEMA_MAX),           // 50, KHÔNG phải TOOL_ARGS_MAX
});
export type ProcessToolItem = z.infer<typeof ProcessToolItemSchema>;
```
- Nguồn (`tool-catalog.repo`): `workflows.input_schema` (đã qua `WorkflowInputSchema` khi lưu) — chép `description` nguyên văn; `options` chỉ khi `type = "select"`, vắng ở kiểu khác. Thứ tự `params` = thứ tự `input_schema`.
- Sửa so với plan-contract §6: `params.max(TOOL_ARGS_MAX)` ⇒ `max(INPUT_SCHEMA_MAX)` (workflow catalog cho tới 50 input; 20 là trần **args của stage**, kiểm ở `toolStageIssues` ⇒ `TOOL_INVALID`). Giữ 20 sẽ làm hỏng cả response `/process-editor/context` khi một workflow có > 20 input. `name` dùng `INPUT_NAME_RE` (= regex khoá `args`).

## A2. G2 — hàm thuần contract cho FE validate live
Cùng file `hub-admin/process-tools.ts`. Điều kiện **giống hệt** luật domain (plan-d2 §4); khác ở hình dạng vào (snake_case, bản nháp FE). `processDefStageIssues` **không** gọi hai hàm này (tránh vòng import với `process-steps.ts`); FE gộp: `[...processDefStageIssues(stages, {inputs}), ...toolStageIssues(stages, inputs, tools), ...branchStageIssues(stages)]`. Mỗi hàm cắt ≤ 20 issue, thứ tự `i` tăng, trong stage theo thứ tự bảng dưới.
```ts
import type { ArgSource, BranchRule } from "./processes";               // z.infer của ArgSourceSchema / BranchRuleSchema
import { type ProcessDefIssue, resolveSteps, type StepStageShape } from "./process-steps";
type FieldDraft = { key: string; type: string; required: boolean };
export type ToolStageDraft = StepStageShape & {
  executor: { kind: string; tool_key?: string; args?: Readonly<Record<string, ArgSource>> };
  answerer?: { kind: string }; sources?: readonly unknown[]; must_know?: readonly unknown[]; autofix?: unknown | null;
  output?: { fields?: readonly FieldDraft[] };
};
export type ToolCatalogShape = Pick<ProcessToolItem, "key" | "side_effect" | "params">;
/** Chỉ xét stage `executor.kind === "tool"`. `tool_key ∉ tools` ⇒ KHÔNG issue (server trả 422 PROCESS_REF_INVALID
 *  path `stages.<i>.executor.tool_key`, FE hiện trạng thái catalog). */
export function toolStageIssues(stages: readonly ToolStageDraft[], inputs: readonly { key: string; type: string }[],
  tools: ReadonlyMap<string, ToolCatalogShape>): ProcessDefIssue[];
export type BranchStageDraft = StepStageShape & {
  output?: { fields?: readonly FieldDraft[] };
  after: StepStageShape["after"] & { branch?: readonly Partial<BranchRule>[] };
};
export function branchStageIssues(stages: readonly BranchStageDraft[]): ProcessDefIssue[];
```
**Path theo lỗi** (domain `waitStageIssues`/`toolStageIssues`/`branchStageIssues` trả **cùng** path — thay "Path `stages.<i>.executor`" ở plan-domain §4.6 và plan-d2 §4):

| Luật | Điều kiện | Path |
|---|---|---|
| `WAIT_INVALID` | `after.kind ≠ auto` | `stages.<i>.after` |
| ″ | nguồn input không có / không `date`; nguồn field: `stage_key` không ở bước nhỏ hơn / field không có / không `date` | `stages.<i>.executor.from` |
| ″ | `offset_days` ∉ −365…365 (bản nháp chưa qua zod) | `stages.<i>.executor.offset_days` |
| ″ | `time` không khớp `WAIT_TIME_RE` (bản nháp) | `stages.<i>.executor.time` |
| ″ | `real_action` / sources / must_know / autofix | `stages.<i>.executor` |
| `TOOL_INVALID` | > 20 args; tool có param `file`; sources/must_know/autofix; `answerer.kind ≠ starter` | `stages.<i>.executor` |
| ″ | tên arg ∉ `params`; nguồn input không có; nguồn field: bước không nhỏ hơn / field không khai | `stages.<i>.executor.args.<name>` (tên arg) |
| ″ | thiếu param `required` | `stages.<i>.executor.args.<name>` (tên param thiếu) |
| `TOOL_SIDE_EFFECT` | `side_effect ∧ ¬real_action` | `stages.<i>.real_action` |
| `BRANCH_INVALID` | > 10 luật; stage không đứng một mình trong bước | `stages.<i>.after.branch` |
| ″ (luật `j`, một issue/luật, dừng ở ô đầu sai theo thứ tự) | field ∉ `output.fields` | `stages.<i>.after.branch.<j>.field` |
| ″ | `op` ∉ `BRANCH_OPS` hoặc `lt/le/gt/ge` với trường `string` | `stages.<i>.after.branch.<j>.op` |
| ″ | value khác kiểu trường (`date`: ISO + ngày lịch thật) | `stages.<i>.after.branch.<j>.value` |
| ″ | `goto_step ≤ step` / `≥ số bước` / đích có `real_action` ∧ stage `after ≠ review` | `stages.<i>.after.branch.<j>.goto_step` |

Đồng bộ contract ↔ domain: test `P/adapters/defs/def-rules-parity.test.ts` (lớp 3) chạy cùng bộ def mẫu (≥ 1 ca mỗi hàng bảng) qua hàm contract và hàm domain (sau mapper) ⇒ `toEqual` (path + rule). qc: PD-U60 ca `after:"review"` ⇒ `stages.<i>.after`; PD-U61 ⇒ `.executor.from`; PD2-U02 ca `side_effect` ⇒ `stages.<i>.real_action`; PD-I35 `paths` ∋ path tương ứng từng ca.

## A3. G3 — trường Hub ép / bỏ qua (xác nhận plan-contract §3, plan-d2 §3)
| Trường | `wait_until` (`ensureWaitStage`) | `tool` (`ensureToolStage`) |
|---|---|---|
| `output.template`/`required_sections` | ép `"# {name}\n\n## Bàn giao\n"` / `["Bàn giao"]` | ép `"# {name}\n\n## Kết quả\n\n## Bàn giao\n"` / `["Kết quả","Bàn giao"]` |
| `output.fields` | ép `[]` | **giữ** (dùng bởi `filterToolFields`, rẽ nhánh) |
| `output.filename` | giữ | giữ |
| `answerer` | ép `{kind:"starter"}` | ép `{kind:"starter"}` |
| `token_budget` | ép `null` | ép `null` |
| `timeout_s` | bỏ qua (lưu mặc định) | **giữ** — là timeout gọi tool (`toolInvoker.call({timeoutS})`) |
| `instruction` | giữ, không dùng | giữ, không dùng |
| sources / must_know / autofix | không ép — có ⇒ `WAIT_INVALID` | ép `[]`/`[]`/`null` khi lưu (sau khi đã kiểm `TOOL_INVALID` trên body gửi lên) |
Ép chạy **sau** luật def, giá trị gửi lên bị ghi đè không báo lỗi; response trả giá trị đã ép. FE ẩn các ô bị ép; với `tool` vẫn hiện `fields`, `filename`, `timeout_s`.

## A4. G4–G7 — làm rõ view/notice (bổ sung plan-contract §2, §8)
- **G4** Notice `escalated`: `task_id` = id `review_task` được chuyển cấp (không null); `stage_name` = tên stage của task; `process_name` như cũ. FE mở task theo `task_id` như `review_requested`.
- **G5** `StageView`: (a) `next_retry_at` và `wait` **loại trừ nhau** — mỗi stage tối đa một hẹn mở (`timers.stageTimerKind`), `retry` ⇒ chỉ `next_retry_at`, `wait_until` ⇒ chỉ `wait`; (b) `retry_count` **luôn có** trong mọi `StageView` Hub trả từ P-d1 (int 0–3 = `effectiveRetryCount`), gồm `queued`/`running` sau khi hẹn retry đã bắn (vd lần chạy lại thứ 2 ⇒ 2) và 0 khi chưa thử lại / sang attempt-round mới; `.optional()` chỉ để FE mock cũ không vỡ. `last_error_code` có khi `retry_count > 0` (mã lỗi lần gần nhất), vắng khi 0.
- **G6** `expires_at` nằm ở `ProcessRunSummarySchema` ⇒ có ở danh sách run **và** `ProcessRunFullViewSchema` (kế thừa `extend`). Hub luôn đặt (`null` = không hết hạn). `ProcessRunTaskViewSchema` (người ngoài phòng) **không** có.
- **G7** `open_tasks[].escalated_group` chỉ ở full view (người trong phòng, người bắt đầu chưa rời, admin — HUB-BR-25); `null` khi không chuyển cấp. `my_tasks[].escalated`/`remind_count` có ở **cả hai** view (task của chính người xem; task view vẫn không có `wait`/`retry`/`group`). `ProcessDef.tenant_id` (sẵn có, `hub-admin/processes.ts:235`): `null` = def **mẫu** (không thêm stage `tool` — D2-06, editor context `tools: []`).

## A5. #46 — `teamResumePlan` (`P/domain/runs/team-retry.rules.ts`, T7s/T7)
```ts
export type TeamRunStatus = "running" | "waiting_answer" | "done" | "limit" | "failed" | "cancelled"; // domain/types.ts
/** Cách vào lại team_run mới nhất của (stage, attempt) khi launcher chạy stage team. Thuần, không đổi đầu vào. */
export function teamResumePlan(cur: { status: TeamRunStatus; segmentStartedAt: Date | null; cursor: number } | null):
  "resume_answer" | "resume_retry" | "new";
```
| Đầu vào | Kết quả | Adapter `ensureTeamRun` (`adapters/runs/team-run.repo.ts`) |
|---|---|---|
| `status = "waiting_answer"` (mọi `segmentStartedAt`) | `resume_answer` | như cũ: `status='running'`, `segment_started_at=now`, trả `{resume:true, cursor}` |
| `status = "running"` ∧ `segmentStartedAt = null` ∧ ¬(`cursor < 0`) | `resume_retry` | `segment_started_at=now`, cursor/plan/calls giữ, trả `{resume:true, retry:true, cursor}` ⇒ lần gọi đầu `noCountFirst` (plan §4.3) |
| `null`; `running` ∧ `segmentStartedAt ≠ null`; `running` ∧ `cursor < 0`; `done/limit/failed/cancelled` | `new` | giữ hành vi cũ: hàng `running` sẵn có ⇒ dùng lại id, `resume:false`; không có/đã kết thúc ⇒ INSERT mới (bộ đếm 0) |
`cursor < 0` không xảy ra sau `pauseForRetry` (ép `max(cursor,0)`) ⇒ coi là dữ liệu hỏng ⇒ `new`. Điều kiện viết `cursor < 0` nên đầu vào thiếu `cursor` (test cũ) vẫn ra như bảng. qc: PD-U93…U97 thêm `cursor: 0` vào đầu vào; thêm ô `{running, null, cursor:-1}` ⇒ `new`.

## A6. #37 — import contract trong file dời vào `domain/` (ADR-0023: lớp 1 không import `@ai/contracts`)
**Khai lại** (mapper test plan-domain §6 khẳng định bằng hằng contract; thêm vào bảng §6):
| Nơi | Thêm | Khẳng định mapper test |
|---|---|---|
| `domain/types.ts` | `TaskKind = "review"\|"ask"\|"decision"` · `TaskStatus = "open"\|"closed"` · `TeamRunStatus` (A5) | `AssertEqual` với `TASK_KINDS`/`TASK_STATUSES`/`TEAM_RUN_STATUSES` |
| `domain/limits.ts` | `REDO_MAX = 3` · `ASKS_MAX = 3` · `FORWARD_CHAIN_MAX = 3` | `toEqual` hằng contract `chat/processes.ts:17–19` |
| `domain/tasks/decision.rules.ts` | `DECISION_OPTION_ORDER: readonly DecisionOption[] = ["add_attempt","use_current","cancel"]` · `AUTOFIX_REASONS: ReadonlySet<DecisionReason>` = {`autofix_check_failed`,`sandbox_unavailable`,`apply_conflict`,`apply_failed`} · `isAutofixReason(r)` · `FORCE_USE_CURRENT` · `decisionOptionsFor` · `decisionAssignees` | `DECISION_OPTION_ORDER` `toEqual([...DECISION_OPTIONS])` (**giữ thứ tự** — UI dùng); `∀ r ∈ DECISION_REASONS: domain.isAutofixReason(r) === runs/autofix.rules.isAutofixReason(r)` |

**Từng file** (import hiện tại → thay bằng):
| File cũ → đích (task) | Import hiện tại | Thay bằng |
|---|---|---|
| `core/process-state.rules.ts` → `domain/runs/run-state.rules.ts` (T7s) | `ASKS_MAX, REDO_MAX, DecisionOption, DecisionReason, ProcessRunStatus, StageRunStatus` từ `@ai/contracts/chat` | hằng ⇐ `../limits`; kiểu ⇐ `../types` |
| `core/step.rules.ts` → `domain/runs/step.rules.ts` (T8s) | `ProcessRunStatus, StageRunStatus` (type) | `../types` |
| `core/run-access.rules.ts` → `domain/runs/run-access.rules.ts` (T8s, **toàn file**, 67 dòng) | `DecisionReason` (type) | `../types` |
| `core/task.rules.ts` → `domain/tasks/decision.rules.ts` (T8s: `FORCE_USE_CURRENT`, `decisionOptionsFor`, `decisionAssignees`) | `DecisionOption, DecisionReason` (type) · `DECISION_OPTIONS` · `autofixDecisionOptions, isAutofixReason` (`../runs/autofix.rules`) · `REVIEW_GROUP_REASONS` (`./run-access.rules`) | `../types` · `DECISION_OPTION_ORDER` (cùng file) · `isAutofixReason` + nhánh autofix ⇒ `["add_attempt","cancel"]` (cùng file) · `../runs/run-access.rules` |
| `core/task.rules.ts` → `domain/tasks/task-access.rules.ts` (T9s: `canAct`, `TaskFacts`) | `ProcessRunStatus, TaskKind, TaskStatus, DecisionReason` (type) · `isTerminal` (`./process-state.rules`) · `canDecide, RunFacts, Viewer` (`./run-access.rules`) | `../types` · `../runs/run-state.rules` · `../runs/run-access.rules` |
| `core/task.rules.ts` (còn lại) | `askExcerpt` + `TASK_EXCERPT_MAX` | **giữ ở `core/task.rules.ts`** (ngoài phạm vi P-d, Luật 4 — không dời) |
| `gates/back.rules.ts` → `domain/gates/back.rules.ts` (T8s) | `StageRunStatus` (type) | `../types` |
| `notify/notify.rules.ts` → `domain/notify/remind.rules.ts` (T9s) | `TaskStatus` (type) | `../types` |
| `asks/ask.rules.ts` → `domain/asks/forward.rules.ts` (T9s) | `FORWARD_CHAIN_MAX` · `TaskKind, TaskStatus` (type) | `../limits` · `../types` |
| `runs/autofix.rules.ts` | `@ai/contracts/{chat,hub,hub-admin}` | **không dời, không sửa** (P-c; vẫn export `isAutofixReason`/`autofixDecisionOptions` cho test khoá P-c/P-c2 — parity test ở bảng trên) |

**Người gọi đổi đường dẫn** (chỉ dòng import, cùng task dời; không shim): run-state ⇐ `asks.service`, `gates.{effects,service}`, `runs/{apply-driver,apply-settle,launcher,stage-driver,step-persist,team-runner,view.service}`, `runs/autofix-hub.test` · step ⇐ `gates/{back.effects,gates.effects,gates.service}`, `runs/{launcher,launcher-session,launcher-step,resolve-apply,step-persist,sweeps,stage-driver,view-steps}` · run-access ⇐ `asks.service`, `core/task-view`, `gates.service`, `runs/{start.service,view.service}`, **`modules/attachments/autofix-files.rules.ts`** (`import type { RunAccess }` — khác module, chỉ kiểu từ lớp 1; reviewer xác nhận ADR-0023) · decision ⇐ `gates.service`, `runs/{sweeps,team-runner,view-steps}` (`askExcerpt` của `team-runner` vẫn từ `core/task.rules`) · task-access ⇐ `core/task-view` · back ⇐ `gates/back.effects` · remind ⇐ `notify/notifier` (+ use case nhắc) · forward ⇐ `asks.service`. Unit test cạnh file dời theo: `core/task.rules.test.ts` ⇒ `domain/tasks/decision.rules.test.ts`, `gates/back.rules.test.ts` ⇒ `domain/gates/back.rules.test.ts`.
Test khoá qc sửa đường dẫn (bổ sung plan-domain §7): T8q thêm `P-a/step0/rules/run-access.test.ts` (⇒ `domain/runs/run-access.rules.ts`); `P-c/rules/autofix-rules.test.ts:21`, `P-c2/rules/_rules2.ts:25` (`loadCoreTask` ⇒ `domain/tasks/decision.rules.ts` cho `decisionOptionsFor`); `P-a/step0/rules/task.test.ts` tách nạp 3 nơi (`canAct` ⇒ task-access, `decisionAssignees` ⇒ decision, `askExcerpt` ⇒ `core/task.rules.ts` giữ).

## A7. #47 — trả lời câu hỏi qc (test-plan §10, test-plan-d2 §câu hỏi)
| # | Quyết định | So với mặc định qc |
|---|---|---|
| Q4 | `createHubUow(db: Db, deps: { clock: Clock; publish: (events: readonly OutboxEvent[]) => Promise<void> }): UnitOfWork` — `publish` **bắt buộc**; mount truyền `makeOutboxPublisher(processDeps)` (`adapters/outbox.ts`). Gọi đúng một lần sau COMMIT với sự kiện của lần thử thành công; rollback/ném ⇒ không gọi; chạy lại 40P01/40001 ⇒ bỏ gom lần hỏng. `bindTx(tx, tenantId)` trả `{ repos, events(): readonly OutboxEvent[] }` (người gọi tự phát) | **xác nhận** (`deps.publish` giả ghi mảng) |
| Q6 | `interrupted` **thắng**: `interrupted ⇒ "interrupted"`; ngược lại `code = "TIMEOUT" ⇒ "job_timeout"`; còn lại `"agent_failed"` | khác: có quy tắc ⇒ qc nên thêm 1 ô `{code:"TIMEOUT", interrupted:true} ⇒ "interrupted"` |
| Q9 | `round` và `attempt` bắt đầu **1** (DEFAULT 1 — 0019:189, 0024:21). Lần retry đầu: `retry:<sr>:1:1:1`. `n` = số hẹn `retry` của **stage** (mọi attempt/round) + 1 ⇒ không reset khi sang attempt mới (vd `retry:<sr>:1:2:4`) | **xác nhận** mẫu `^retry:<sr>:\d+:\d+:<n>$`; có thể khẳng định chặt `:1:1:` cho lần đầu |
| Q10 | `SweepResult` (`core/handles.ts`) += `timers: number` = số hẹn được đặt `fired_at` trong lượt (`requeue` + `finish_wait`; không đếm `drop`/lỗi) | **xác nhận**: int vẫn kiểm trạng thái DB (sweeper toàn cục, bẫy X2b2) |
| Q-D2-1 | Nguyên văn dưới. Dòng bảng theo thứ tự khai báo `output.fields` (`filterToolFields` dựng record đúng thứ tự); số `String(v)` (thô, `25000000`); chuỗi: ký tự gạch đứng ⇒ thêm `\` phía trước, xuống dòng ⇒ dấu cách; khối fields `JSON.stringify(fields)` không thụt; không có trường ⇒ không dòng bảng và câu `Đã gọi tool; trường: (không có)`. Hàm thuần **không** cắt `clipHandoff` (≤ 20 key × 32 ký tự luôn < 200 token) | **xác nhận** |
| Q-D2-2 | `connectFailed: true` **chỉ** khi `fetch` ném lỗi **lập kết nối** (mã `ECONNREFUSED`/`ConnectionRefused`/`FailedToOpenSocket`/`ENOTFOUND`/`EAI_AGAIN`) — yêu cầu chưa tới Dify. Server đã nhận kết nối rồi đóng socket (trước/sau đọc body) ⇒ **đã gửi** (`sent: true`) — an toàn: tool `side_effect` không tự gọi lại | **khác** mặc định "có": fake đóng socket ⇒ `sent:true`; ca "trước khi gửi" dùng `baseUrl` trỏ cổng đóng (`127.0.0.1:<cổng trống>`) |
| Q-D2-3 | Stage ở bước bị nhảy chỉ có thể `pending` ⇒ không có hẹn mở; `cancelTimers(skipped)` vẫn gọi (phòng thủ, idempotent, 0 hàng) | **xác nhận** (PD2-I33 chỉ kiểm 0 hẹn mở) |

`toolOutputMd("Xuất HĐ", {tong_tien: 25000000, ma_kh: "KH1"})` (Q-D2-1, = PD2-U09) trả đúng:
````text
# Xuất HĐ

## Kết quả
| Trường | Giá trị |
|---|---|
| tong_tien | 25000000 |
| ma_kh | KH1 |

## Bàn giao
Đã gọi tool; trường: tong_tien, ma_kh

```fields
{"tong_tien":25000000,"ma_kh":"KH1"}
```
````
(kết thúc bằng một `\n` sau dấu ```` ``` ```` đóng; giữa các khối đúng một dòng trống như trên).

## A8. Bổ sung readiness lần 3 (#58, #57, #64, #65)

### A2 bổ sung — #58 path WAIT phía contract
| Điểm | Quyết định |
|---|---|
| `waitStageIssues` (contract) | Hàm thuần trong `packages/contracts`, được `processDefStageIssues(stages, {inputs})` gọi (plan-contract §3) cho stage `kind = wait`. Trả `issues` có `path` **đúng bảng A2** (giống `waitStageIssues` của domain): `stages.<i>.after` · `stages.<i>.executor.from` · `stages.<i>.executor.offset_days` · `stages.<i>.executor.time` · mọi lỗi WAIT còn lại ⇒ `stages.<i>.executor`. Thay path WAIT ở plan-contract:79 |
| Test parity PD-C13 | So `processDefStageIssues(stages, {inputs})` (contract) với `waitStageIssues` (domain) trên **mọi hàng WAIT** của bảng A2: cùng `code` + cùng `path`. Không đi qua hàm kiểm tool/branch |
| `contracts-pd1` | Mỗi path WAIT của A2 có **1 ca** riêng (5 ca: `after`, `executor.from`, `executor.offset_days`, `executor.time`, `executor`) |

### #57 — `ESCALATE_INVALID` (xác nhận plan-domain:119)
Hàm domain `escalateStageIssues` (plan-domain; readiness #74/TC10) và hàm contract cho FE kiểm bản nháp cùng trả `ESCALATE_INVALID` khi:
1. `escalate` trùng Group duyệt (Group nhận leo thang = Group duyệt);
2. `escalate` ở stage có `after.kind = auto`;
3. `afterH ∉ 4…2160` (giờ).

Qua API (`POST/PUT` process-def): ngưỡng `afterH` sai và `escalate` ở stage `auto` đều **400 `VALIDATION_ERROR`** do zod kiểm trước (contract `after.auto` strict, không có khoá `escalate`) — không bao giờ tới hàm domain/422. Chỉ trùng Group duyệt (1) mới tới domain (422 `ESCALATE_INVALID`). PD-U68 theo plan-domain:119 (readiness #57): hàm thuần domain/contract báo `ESCALATE_INVALID` cho `afterH` 3 và 2161 (FE kiểm bản nháp); qua API vẫn 400 do zod chặn trước.

### A7 bổ sung — ghi chú cho qc
| # | Ghi chú |
|---|---|
| #64 PD2-I06 | Hub đọc `base_url` của workflow từ cache `config.catalog()` (`mcp.service.ts:185,258`) ⇒ ca "cổng đóng rồi ok" **giữ `base_url` cố định** trên cổng P đã giữ trước. Lần 1 chưa có server ở P (ECONNREFUSED ⇒ `connectFailed`); **dựng fake trên P trước** khi hẹn retry bắn. Không đổi `base_url` giữa chừng (cache không thấy) |
| #65 PD-I75 | Ép 40P01 ở UoW: callback lần đầu ném `Object.assign(new Error("deadlock"), { code: "40P01" })`, lần sau chạy bình thường. Mẫu: `packages/db/src/hub-rls.int.test.ts:162`; mã retry: `RETRYABLE` ở `hub-scope.ts:21` |

## A9. Nhịp vòng nhắc theo staging ADR-0017 (2026-10-17, tự quyết theo Luật 2)

Staging N=10.000: một lô 100 task mất p95 1,09 s. Vòng nhắc D-PD10 chạy 300 s/lượt, mỗi lượt chỉ một lô ⇒ tồn 10.000 task tới hạn cùng lúc cần ~100 lượt ≈ 8 giờ (vượt PD-R18 "trễ ≤ 5 phút"). Sửa ở T9: mỗi lượt `startProcessReminder` **xả tới khi lô < 100 hoặc hết ngân sách 60 s** (≈ 5.000 task/lượt theo số đo), rồi chờ lượt sau. Handle `remindOnce(deps)` = **một lượt xả** (nhiều lô liên tiếp tới khi lô < 100 hoặc hết 60 s), trả **tổng** số task đã nhắc của cả lượt — PD-P10/P11/P13 dựa vào giá trị này (readiness #87). Int test: 250 task tới hạn ⇒ một lượt nhắc đủ 250. Cùng T9 sửa #190 (khoá hàng, kiểm `rowCount`) để xả song song nhiều Hub không trùng. Hết hạn run (`sweepOnce` 3 s, 20.000 run ≈ 201 lượt) giữ nguyên: hạn tính theo ngày nên trễ vài phút chấp nhận được.

## A10. Vòng nền xử lý theo tập + NFR (CR-093, người dùng chốt 2026-10-17) — thắng A9 chỗ lệch

Staging N=10.000 cho thấy chậm do **lặp từng hàng**: hết hạn ≈ 15 lượt DB/Redis mỗi run (tx riêng, `head`+`lockRun`+3 update+`enqueueThread`+notifier+`publishUserEvents`+`postThread` trong vòng) ⇒ p95 2,99 s/lô 100; nhắc 5 câu/task ⇒ p95 1,09 s/lô 100.

**Nhắc (T9, cùng #190 và A9):** một tx `UnitOfWork.systemBatch` mỗi lô (A11), thứ tự (readiness #88): (1) **khoá** ứng viên `claimDueReminders(100, now)` = `select … from hub.review_tasks t … for update of t skip locked limit 100`, trả hàng kèm `tenant_id`; (2) **nạp người nhận** một câu (`review_task_assignees` ∪ `admin.group_members` theo `= any(task_ids)`, khớp `tenant_id` hàng nguồn — K3 lô, A11); (3) **luật lớp 1** trên mảng trong bộ nhớ: `remind.rules` tính `remind_at`/`remind_count` mới mỗi hàng, `noticeRecipients` (readiness #94); (4) **áp** `markRemindedMany(rows)` = `update hub.review_tasks t set … from unnest($id[], $tenant_id[], $remind_at[], $remind_count[]) u where t.id = u.id and t.tenant_id = u.tenant_id` (một câu); `NoticeWriter.insertMany` một câu nhiều hàng; `unread` một câu `group by tenant_id, user_id`. Sau COMMIT phát Redis **một lần** (pipeline). Lượt xả lô tới khi < 100 hoặc hết 60 s (A9).
**Chuyển cấp theo tập (T9, #88):** cùng tx lô nhắc: `claimDueEscalations(100, now)` = một câu claim-update (`update … set escalated_at = $now where (id, tenant_id) in (select … for update skip locked limit 100) returning id, tenant_id, …`). 0 hàng ⇒ chỉ 1 câu. Có hàng ⇒ `escalate.rules` (lớp 1) chọn Group hợp lệ / bỏ qua trên mảng ⇒ insert `review_task_assignees` (`via='escalated'`), audit `escalate`, notice `escalated` — mỗi loại **một câu nhiều hàng**, `tenant_id` lấy từ hàng nguồn; DM hệ thống qua outbox sau COMMIT.
**Ngân sách PD-P15 (TC16):** không tính `set_config('app.scope')` (hạ tầng `withHubScope`, một câu/tx) và BEGIN/COMMIT/SAVEPOINT/`pg_type`. Nhắc = khoá ứng viên 1 + update `unnest` 1 + người nhận 1 + insert notice 1 + unread 1 + ứng viên chuyển cấp 1 = **6** (một tx/lô, 0 chuyển cấp). Tính `set_config` hoặc chia tx theo tenant ⇒ 7 (lý do A11 dùng `systemBatch`).
**Hết hạn (T10):** một tx `systemBatch` mỗi lô: `RunRepo.claimExpired(100, now)` = `update hub.process_runs … where (id, tenant_id) in (select … for update skip locked limit 100) returning id, tenant_id`; `stage_runs` và `review_tasks` cập nhật bằng `process_run_id = any(ids)` **và** khớp `tenant_id` hàng nguồn; `enqueueThread` nhiều hàng một câu; `Notifier.runsFinished(ids)` bản mảng (`ids` = hàng `{id, tenantId}` từ `claimExpired`; **không** nhận `Tx` — plan K1; readiness #90: adapter gắn tx của `systemBatch`, **chèn notice `run_finished` trong tx** bằng một câu `insert hub.process_notices … select` theo `(id, tenant_id)` + một câu `unread`, rồi `outbox.emit({kind:"user_events"})`; chỉ phát Redis sau COMMIT; hết hạn = 5 câu so với lượt rỗng, ≤ 6). **Không** gọi `postThread` trong vòng — `thread-poster` (`THREAD_RECONCILE_MS`) đăng. Phát Redis một lần sau COMMIT.
**Index (#84):** `unread` dùng `process_notices_unread_idx (user_id) WHERE read_at IS NULL` **đã có** (0019:391) — không thêm DDL (plan-db §5 có dòng). Kiểm `explain` cho câu khoá ứng viên nhắc, câu khoá ứng viên chuyển cấp, câu chọn run hết hạn, `unread`.
**NFR (#82, theo test khoá PD-P13/P14; Lệnh xong T9/T10 thêm `PERF=1 bun --env-file=.env.local --config=bunfig.perf.toml test tests/acceptance/P-d/perf/` — CR-093, #83):** p95 ≤ **50 ms** đo **cả lời gọi** `remindOnce` / `sweepOnce` với đúng 100 hàng tới hạn, 20 lần, Postgres local — gồm phát Redis sau COMMIT, và với `sweepOnce` gồm cả các phần khác của lượt quét (hẹn giờ, orphan, `interrupted`). "10.000 task nhắc ≤ 6 s" / "20.000 run hết hạn ≤ 12 s" = **tổng thời gian các lời gọi liên tiếp** tới khi xả hết tồn (lời gọi trả 0), không tính nhịp chờ giữa lượt. Không đạt ⇒ task chưa xong. Staging chạy lại `load.spike` sau T10 để xác nhận trên Redis thật.
**Không đổi hành vi:** cùng trạng thái, notice, sự kiện, audit như bản lặp; test khoá P-a PF1/PF3 phải xanh nguyên.

## A11. `UnitOfWork.systemBatch` — vòng nền theo tập (#81, CR-093; thắng spec-ca CA-R06/§4, plan:67, plan §4.9/§5, K1/K3 chỗ lệch)
| Điểm | Quyết định |
|---|---|
| Port | `systemBatch(fn)`: scope `system`, một tx mỗi lô, **chỉ** vòng nền theo tập (nhắc, chuyển cấp, hết hạn); `fn` nhận repo lô đã gắn tx, không `Tx`; chạy lại 40P01/40001 + outbox sau COMMIT như `system`. Use case theo hàng giữ `tenant`/`system(tenantId)`; vòng hẹn giờ T8 giữ `system(tenantId)` từng hàng |
| Repo lô (hàng mang `tenant_id`) | `ReviewTaskRepo.{claimDueReminders(limit, now), markRemindedMany(rows), claimDueEscalations(limit, now)}` · `NoticeWriter.insertMany(rows)` · `RunRepo.claimExpired(limit, now)` · `Notifier.runsFinished(ids)` (không `Tx`; gắn tx `systemBatch`, notice chèn trong tx, Redis sau COMMIT — #90). Thay `dueReminders/markReminded/dueEscalations/markEscalated` của plan:67 cho vòng nền |
| K3 lô | mọi join khớp `tenant_id` hàng nguồn; insert lấy `tenant_id` từ hàng nguồn (không từ caller/hằng); `FOR UPDATE SKIP LOCKED` theo `(id, tenant_id)`; test 2 tenant cùng lô qua use case thật (AC-H46): notice/assignee/audit/thread đúng tenant hàng nguồn, 0 hàng chéo |
| K1 | giữ; ngoại lệ duy nhất: repo của `systemBatch` mang `tenant_id` theo hàng thay vì nhận từ UoW |
| T6c | review cả `systemBatch`: chỉ vòng nền gọi (không route/use case HTTP), K3 lô, test 2 tenant |

Ghi thêm (readiness lần 5): TC13 — `runs.lock(runId)`, `timers.lockById(id)` ⇒ `null` khi không thấy, `timers.markFired(id, now)`, `timers.cancelForRun(runId, "all", now)`. TC3 (thay plan §4.9) — audit `escalate` ghi `summary {from_group, to_group}`, `actor_id` NULL (`hub.audit_log` chỉ có before/after/summary). TC4 (thêm vào plan §6) — quay lại ∥ bắn `wait_until` = huỷ XOR bắn: quay lại trước ⇒ `cancelled_at`, 0 output; bắn trước ⇒ `fired_at` + output rồi stage reset. TC12 — `ProcessEditorContextSchema` ở `@ai/contracts/hub-admin` (`hub-admin/processes.ts`).
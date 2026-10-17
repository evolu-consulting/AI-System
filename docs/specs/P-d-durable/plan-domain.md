# Plan phụ lục · Lớp 1 domain + chữ ký luật thuần P-d (qc viết test trước)

Phần của [`plan.md`](plan.md). `P/` = `apps/hub-api/src/modules/processes/`. Lớp 1 chỉ built-in ECMAScript (ADR-0023 §2): **không** `@ai/contracts`, `@ai/db`, `zod`, `node:*`, `TextEncoder`, `new Date()` không tham số, `Date.now()`. Thời điểm vào hàm luôn là tham số `now: Date`. Test lớp 1 chạy không DB: `tests/acceptance/P-d/rules/**` (qc) nạp đúng đường dẫn dưới bằng `tryLoad` mới (báo "module vắng: <đường dẫn>").

## 1. Kiểu domain tự khai — `P/domain/types.ts` (≤ 120 dòng)
```ts
export type ProcessRunStatus = "running" | "waiting_review" | "waiting_answer" | "needs_decision" | "done" | "cancelled"
  | "failed" | "expired" | "waiting_timer";
export type StageRunStatus = "pending" | "queued" | "running" | "waiting_answer" | "waiting_review" | "needs_decision"
  | "done" | "cancelled" | "failed" | "waiting_timer";                       // P-d2 (T17) + "skipped"
export type DecisionReason = "redo_limit" | "ask_limit" | "template_invalid" | "team_calls" | "team_tokens" | "team_time"
  | "team_no_change" | "job_timeout" | "stage_tokens" | "run_tokens" | "agent_failed" | "permission_lost"
  | "user_inactive" | "interrupted" | "source_unresolvable" | "back_limit" | "autofix_check_failed"
  | "sandbox_unavailable" | "apply_conflict" | "apply_failed" | "retry_exhausted" | "timer_invalid"; // P-d2 + "tool_failed"
export type DecisionOption = "add_attempt" | "use_current" | "cancel";
export type ExecutorKind = "agent" | "team" | "apply" | "wait_until";          // P-d2 + "tool"
export type TimerKind = "wait_until" | "retry";
export type JobErrorClass = "transient" | "business";
export type StageAfter = "review" | "auto";
/** Con trỏ hẹn giờ (đọc từ repo; `Date` thay chuỗi ISO — mapper chuyển). */
export type Timer = { id: string; tenantId: string; runId: string; stageRunId: string; kind: TimerKind;
  dueAt: Date; firedAt: Date | null; cancelledAt: Date | null };
export type RetryState = { retryCount: number; retryAttempt: number | null; retryRound: number | null;
  attempt: number; round: number };
```
Kiểu def tối thiểu luật lưu cần (`P/domain/defs/def-shape.ts`, tự khai, không phải `ProcessStageDef` của contract):
```ts
export type WaitFrom = { kind: "input"; key: string } | { kind: "field"; stageKey: string; field: string };
export type StageShape = { key: string; step: number; realAction: boolean; after: StageAfter;
  reviewGroupId: string | null; executorKind: ExecutorKind; hasSources: boolean; hasMustKnow: boolean;
  hasAutofix: boolean; wait: { from: WaitFrom; offsetDays: number; time: string } | null;
  fields: readonly { key: string; type: "number" | "string" | "date"; required: boolean }[];
  remindEveryH: number | null; escalate: { afterH: number; groupId: string } | null };
export type InputShape = { key: string; type: "text" | "select" | "file" | "source_ref" | "date" };
export type DefIssue = { path: string; rule: "WAIT_INVALID" | "ESCALATE_INVALID" };   // P-d2 + TOOL_*/BRANCH_INVALID
```
`step` đã chuẩn hoá (`resolveSteps` chạy ở mapper, lớp 3).

## 2. Hằng — `P/domain/limits.ts`
`STAGE_RETRY_MAX=3` · `RETRY_BACKOFF_S=[30,120,480]` · `REMIND_EVERY_H={min:4,max:168}` · `REMIND_MAX=10` · `REMIND_AFTER_H=24` · `ESCALATE_AFTER_H={min:4,max:2160}` · `PROCESS_TTL_DAYS={min:1,max:365,default:7}` · `WAIT_OFFSET_DAYS={min:-365,max:365}` · `WAIT_HORIZON_DAYS=730` · `WAIT_TIME_DEFAULT="09:00"` · `TIMER_SWEEP_BATCH=100` · P-d2: `TOOL_ARGS_MAX=20` · `TOOL_RESULT_MAX_BYTES=65536` · `BRANCH_RULES_MAX=10` · `BRANCH_OPS`. Mapper test khẳng định bằng hằng contract (CA-R03).

## 3. Lỗi — `P/domain/errors.ts` + map lớp 3
```ts
export type ProcessDomainError = "TIMER_STATE" | "RUN_STATE" | "NO_OUTPUT" | "REF_INVALID" | "DEF_INVALID";
export class DomainError extends Error { constructor(readonly code: ProcessDomainError, readonly details?: unknown) {…} }
```
Kết quả nghiệp vụ bình thường trả giá trị (vd `decideRetry`), không ném. `P/adapters/processes.mapper.ts`:
| Domain | Contract · HTTP |
|---|---|
| `RUN_STATE` | `PROCESS_RUN_STATE` 409 |
| `NO_OUTPUT` | `NO_OUTPUT` 409 |
| `TIMER_STATE` | `PROCESS_RUN_STATE` 409 (không lộ trạng thái hẹn) |
| `REF_INVALID` | `PROCESS_REF_INVALID` 422 `{path, ref}` |
| `DEF_INVALID` | `PROCESS_DEF_INVALID` 422 `{paths, rules}` |
`const DOMAIN_ERROR_MAP: Record<ProcessDomainError, {code; status}>` — thiếu mã ⇒ typecheck đỏ; ném qua `processError`/`defError` sẵn có.

## 4. Chữ ký luật P-d1 (đường dẫn = đích qc nạp)
### 4.1 `domain/runs/job-error.rules.ts` (PD-R01/R02 · readiness #3)
```ts
export const TRANSIENT_JOB_REASONS: ReadonlySet<string>; // timeout, upstream, crash, orphaned, provider_busy, tenant_slots
export const TRANSIENT_JOB_CODES: ReadonlySet<string>;   // TIMEOUT, UPSTREAM_ERROR
/** reason ≠ null ⇒ tạm ⇔ reason ∈ TRANSIENT_JOB_REASONS; reason null ⇒ tạm ⇔ code ∈ TRANSIENT_JOB_CODES; còn lại nghiệp vụ.
 *  Mã/lý do lạ (chuỗi ngoài danh sách) ⇒ business. KHÔNG đọc provider_state. */
export function classifyJobError(code: string | null, reason: string | null): JobErrorClass;
/** Lý do needs_decision "cũ" (A3) khi KHÔNG thử lại: TIMEOUT ⇒ job_timeout; interrupted ⇒ interrupted; còn lại agent_failed. */
export function legacyFailReason(f: { code: string | null; interrupted: boolean }): "job_timeout" | "agent_failed" | "interrupted";
```
→ thay bởi plan-addendum A7 Q6: thứ tự TIMEOUT/`interrupted` (`interrupted` thắng).
Bảng đầy đủ (qc phủ mọi ô; `—` = null). Cột = `reason`; hàng = `code`. **T** = tạm, **N** = nghiệp vụ:

| code \ reason | — | timeout · upstream · crash · orphaned · provider_busy · tenant_slots | quota · provider_unavailable · cancelled · invalid_payload · invalid_output · sandbox · credential · refused · attachment · container | lạ |
|---|---|---|---|---|
| `TIMEOUT` | T | T | N | N |
| `UPSTREAM_ERROR` | T | T | N | N |
| `ALL_PROVIDERS_EXHAUSTED` | N | T | N | N |
| `CANCELLED` · `BUDGET_EXCEEDED` · `NOT_CONFIGURED` · `INTERNAL_ERROR` | N | T | N | N |
| lạ / `null` | N | T | N | N |
`interrupted` (stage-driver `aborted` không do huỷ run; vòng quét D11) = **tạm, không qua hàm** (người gọi đặt `cls="transient"`). Lưu ý: reason tạm thắng code (vd `INTERNAL_ERROR`+`crash` ⇒ T) — đúng PD-R01 bước (1).
### 4.2 `domain/runs/retry.rules.ts` (PD-R03/R04/R05/R06/R08)
```ts
/** Lượt thử hiệu lực: chỉ đếm khi (retryAttempt, retryRound) = (attempt, round); khác ⇒ 0 (reset ngầm PD-R06). */
export function effectiveRetryCount(s: RetryState): number;
export function retryDueAt(now: Date, nextCount: 1 | 2 | 3): Date;   // now + RETRY_BACKOFF_S[nextCount-1] s
export type RetryInput = { cls: JobErrorClass; state: RetryState; sideEffectSent: boolean;
  legacy: "job_timeout" | "agent_failed" | "interrupted"; now: Date };
export type RetryDecision =
  | { kind: "retry"; retryCount: 1 | 2 | 3; dueAt: Date }
  | { kind: "decide"; reason: DecisionReason };
/** business ⇒ decide(legacy); transient ∧ sideEffectSent ⇒ decide(legacy) (A3); transient ∧ effective ≥ 3 ⇒
 *  decide("retry_exhausted"); còn lại ⇒ retry(effective+1, retryDueAt). */
export function decideRetry(i: RetryInput): RetryDecision;
```
Team (PD-R08) dùng **cùng** `decideRetry` (counter của `stage_runs`); khác biệt ở use case (§ plan 4.3).
### 4.3 `domain/runs/run-state.rules.ts` (tách nguyên `core/process-state.rules.ts` ở T7s, rồi T7/T8 sửa)
Giữ nguyên chữ ký `transition(s: RunState, e: RunEvent): Transition`, `isTerminal`, kiểu `RunEvent/RunState/StageState/Effect/Transition` (kiểu enum lấy từ `../types`). Thay đổi logic (T7/T8):
| Sự kiện | Hành vi mới |
|---|---|
| `decide add_attempt`, `decisionReason = retry_exhausted` | stage `queued` (attempt **giữ**), run `running`, effects `["queue_stage","reset_retry"]` |
| `decide add_attempt`, `timer_invalid` | stage `queued` (attempt giữ), effects `["queue_stage"]` (launcher tính lại ngày) |
| `decide use_current`, `timer_invalid` | **không cần output** ⇒ advance với effects `["write_wait_skip", …advance]` (stage `after` luôn `auto`, PD-R17) |
| `decide use_current`, `retry_exhausted` | theo luật sẵn có (cần output, else `NO_OUTPUT`) |
| ACCEPTS `cancel`/`expire` | `"active"` gồm `waiting_timer` (isTerminal không đổi) |
`Effect` += `"reset_retry"`, `"write_wait_skip"` (cuối union). Thử lại **không** đi qua `transition` (use case `handleJobFailure` quyết trước — plan §4.2).
### 4.4 `domain/runs/step.rules.ts` (tách nguyên `core/step.rules.ts` ở T8s)
Chữ ký giữ nguyên. Đổi (T8): `stageGateStatus(run, "waiting_timer") = "waiting_timer"`; `runStatusOf`: thứ tự `needs_decision > running(pending|queued|running) > waiting_answer > waiting_review > waiting_timer`; `step_done` khi mọi stage `done` (P-d2: `done|skipped`). Hàm mới:
```ts
/** Stage đang backoff thử lại tính như `queued` cho trạng thái run (PD-R15 readiness #20). */
export function statusForRun(s: StageRunStatus, timerKind: TimerKind | null): StageRunStatus;
```
### 4.5 `domain/runs/active-cap.rules.ts` (PD-R16)
`export const CAP_COUNTED: readonly ProcessRunStatus[]` (4 trạng thái) · `countsTowardCap(s): boolean` · `isActive(s): boolean` (5 trạng thái, gồm `waiting_timer`).
### 4.6 `domain/defs/wait-def.rules.ts` (PD-R17)
→ thay bởi plan-addendum A2 (path WAIT_INVALID).
```ts
/** WAIT_INVALID: after≠auto | realAction | hasSources | hasMustKnow | hasAutofix | nguồn input không có/không type date |
 *  nguồn field: stage_key không có ở bước NHỎ HƠN hoặc field không có/không type date. Path `stages.<i>.executor`. */
export function waitStageIssues(stages: readonly StageShape[], inputs: readonly InputShape[]): DefIssue[];
```
### 4.7 `domain/defs/escalate-def.rules.ts` (PD-R23)
```ts
/** ESCALATE_INVALID: escalate ≠ null ∧ (after ≠ review | groupId = reviewGroupId | afterH ∉ 4…2160) — path
 *  `stages.<i>.after.escalate`. Tồn tại/cùng tenant KHÔNG xét ở đây (adapter ⇒ PROCESS_REF_INVALID). */
export function escalateStageIssues(stages: readonly StageShape[]): DefIssue[];
export function escalateGroupRefs(stages: readonly StageShape[]): { path: string; groupId: string }[];
```
### 4.8 `domain/defs/ttl.rules.ts` (PD-R24/R25)
```ts
export function ttlOnCreate(v: number | null | undefined): number | null;           // undefined ⇒ 7
export function ttlOnUpdate(v: number | null | undefined, current: number | null): number | null; // undefined ⇒ current
export function expiresAt(startedAt: Date, ttlDays: number | null): Date | null;
```
### 4.9 `domain/runs/start-inputs.rules.ts` (tách phần thuần của `runs/start-inputs.ts` ở T8s + T8 thêm `date`)
```ts
export type InputValue = { key: string; type: string; value?: string };   // tối thiểu cho luật
/** Giữ hành vi cũ của `shapeValid` cho text/select/file/source_ref; `date`: value khớp ISO + ngày lịch có thật. */
export function startInputIssues(defs: readonly (InputShape & { required: boolean; options?: readonly string[] })[],
  values: readonly InputValue[]): { index: number; path: "value" | "key" | "type" }[];
export function isCalendarDate(s: string): boolean;
```
### 4.10 `domain/timers/timer-key.rules.ts` (PD-R10)
`export function timerKey(k: { kind: TimerKind; stageRunId: string; round: number; attempt: number; n: number }): string` ⇒ `${kind}:${stageRunId}:${round}:${attempt}:${n}`, `n ≥ 1`.
### 4.11 `domain/timers/timer.rules.ts` (PD-R11/R12)
```ts
export function isDue(t: Pick<Timer, "dueAt" | "firedAt" | "cancelledAt">, now: Date): boolean;
export type FireAction = { kind: "requeue" } | { kind: "finish_wait" } | { kind: "drop" };   // drop ⇒ chỉ đặt cancelled_at
/** retry: stage waiting_timer ⇒ requeue; wait_until: stage waiting_timer ⇒ finish_wait; khác (stage đã đổi) ⇒ drop. */
export function fireAction(kind: TimerKind, stageStatus: StageRunStatus, runTerminal: boolean): FireAction;
/** Quay lại tới `toStep` ⇒ stage có `step ≥ toStep` bị ảnh hưởng (bị reset) ⇒ huỷ hẹn của chúng. */
export function stagesToCancelOnBack(stages: readonly { stageRunId: string; step: number }[], toStep: number): string[];
```
### 4.12 `domain/timers/due-at.rules.ts` (PD-R13/R14, TZ-R04)
```ts
export function addDaysIso(isoDate: string, days: number): string;                 // lịch UTC thuần, không giờ
/** Giờ địa phương (date + "HH:MM") ở `tz` ⇒ instant UTC. Thuật toán plan §4.7 (Intl.DateTimeFormat, không thư viện). */
export function localToUtc(isoDate: string, time: string, tz: string): Date;
export function wallClockOf(instant: Date, tz: string): { date: string; time: string }; // "YYYY-MM-DD","HH:MM"
export type WaitDue = { ok: true; dueAt: Date }
  | { ok: false; why: "missing" | "invalid" | "after_expiry" | "beyond_horizon" };
/** base null ⇒ missing; base không phải ngày lịch ⇒ invalid; dueAt > expiresAt (≠ null) ⇒ after_expiry;
 *  dueAt > now + 730 ngày ⇒ beyond_horizon; dueAt ≤ now ⇒ ok (tới hạn ngay). */
export function waitDueAt(i: { base: string | null; offsetDays: number; time: string; tz: string; now: Date;
  expiresAt: Date | null }): WaitDue;
export function waitedText(dueAt: Date, tz: string): string;   // "Đã chờ tới {YYYY-MM-DD HH:MM} ({tz})." (PD-R15)
export const WAIT_SKIP_TEXT: string;                           // "Bỏ chờ theo quyết định." (PD-R14)
/** .md output Hub sinh: `# {stageName}\n\n{line}\n\n## Bàn giao\n{line}\n`. */
export function waitOutputMd(stageName: string, line: string): string;
```
### 4.13 `domain/notify/remind.rules.ts` (tách `notify/notify.rules.ts` ở T9s + PD-R18/R19)
```ts
export function noticeRecipients(t, exclude?): string[];          // giữ nguyên chữ ký cũ
/** Cũ: remindEveryH null ∧ remindedAt null ∧ remindAt ≤ now. Lặp: remindEveryH ≠ null ∧ remindCount < 10 ∧ remindAt ≤ now. */
export function dueReminder(t: { status: "open" | "closed"; remindAt: Date; remindedAt: Date | null;
  remindEveryH?: number | null; remindCount?: number }, now: Date): boolean;
export function nextRemind(t: { remindAt: Date; remindCount: number; remindEveryH: number }):
  { remindAt: Date; remindCount: number };                          // remindAt += N giờ, count+1
/** Giá trị chép vào review_task khi tạo (snapshot). Không cấu hình ⇒ remindAt = created + 24 h như cũ. */
export function reviewTaskTiming(createdAt: Date, cfg: { remindEveryH: number | null;
  escalate: { afterH: number; groupId: string } | null }): { remindAt: Date; remindEveryH: number | null;
  escalateAt: Date | null; escalateGroupId: string | null };
```
### 4.14 `domain/notify/escalate.rules.ts` (PD-R20/R22)
```ts
export function dueEscalation(t: { kind: "review" | "ask" | "decision"; status: "open" | "closed";
  escalateAt: Date | null; escalatedAt: Date | null }, now: Date): boolean;
export type EscalateAction = { kind: "add_group"; groupId: string } | { kind: "skip" };
/** Group đích còn tồn tại ∧ cùng tenant task ⇒ add_group; ngược lại skip (audit escalate_skipped). */
export function escalateAction(p: { groupId: string; groupExists: boolean; groupTenantId: string | null; taskTenantId: string }): EscalateAction;
```
### 4.15 `domain/asks/forward.rules.ts` (tách nguyên `asks/ask.rules.ts` ở T9s + PD-R21)
`forwardCheck(t, to, by)` **giữ chữ ký**; `ForwardTask` thêm tuỳ chọn `escalatedGroupId?: string | null` và `byGroupIds?: ReadonlySet<string>`. Review: tập Group hợp lệ = {`groupId`, `escalatedGroupId`} ∩ (Group của người chuyển khi có `byGroupIds`); `to.groupIds` giao tập đó ⇒ ok, không ⇒ `FORWARD_OUT_OF_GROUP`. Vắng cả hai trường ⇒ đúng hành vi cũ.
### 4.16 `domain/tasks/decision.rules.ts` (tách từ `core/task.rules.ts` ở T8s)
`FORCE_USE_CURRENT` (+ `timer_invalid`, T8) · `decisionOptionsFor(hasOutput, reason)` giữ chữ ký; autofix vẫn qua `isAutofixReason` — domain khai lại tập lý do autofix (`AUTOFIX_REASONS`) thay vì import `runs/autofix.rules.ts`. `retry_exhausted`/`tool_failed` **không** vào `FORCE_USE_CURRENT`.

## 5. Chữ ký luật P-d2 — chi tiết [plan-d2 §4](plan-d2.md)
`domain/defs/tool-def.rules.ts` (`toolStageIssues`), `domain/tools/tool-run.rules.ts` (`buildToolArgs`, `classifyToolError`, `toolFailureDecision`), `domain/tools/tool-output.rules.ts` (`filterToolFields`, `toolOutputMd`), `domain/branch/branch-def.rules.ts` (`branchStageIssues`), `domain/branch/branch.rules.ts` (`evaluateBranch`, `skippedStages`).

## 6. Mapper test — `P/adapters/processes.mapper.test.ts` (CA-R03/R04)
| Khẳng định | Cách |
|---|---|
| `ProcessRunStatus`, `StageRunStatus`, `DecisionReason`, `DecisionOption`, `ExecutorKind`, `TimerKind` = mảng contract | `AssertEqual<Domain, (typeof X)[number]>` + `expect([...]).toEqual([...X])` thứ tự không bắt buộc |
| `JobErrorCode` domain ⊇ `CHAT_RUN_ERROR_CODES`; tập lý do = `JOB_FAIL_REASONS` | `expect` tập |
| Hằng §2 = hằng contract | `expect(DOMAIN.X).toEqual(CONTRACT.X)` mỗi hằng |
| `InputShape.type` = `INPUT_TYPES`; `WaitFrom` ↔ `executor.from` (đổi `stage_key`⇒`stageKey`) | `AssertEqual` trên kiểu đã chuyển, một dòng lý do |
| `DOMAIN_ERROR_MAP` đủ mã | typecheck (`Record`) |
`AssertEqual` đặt ở `P/adapters/assert-equal.ts` (lớp 3, dùng lại cho module khác).

## 7. Tách file cũ P-d1 (task `Ns`, không đổi hành vi; `Nq` qc sửa đường dẫn + lock cùng lúc)
→ thay bởi plan-addendum A6 (import contract trong file dời, người gọi đổi đường dẫn).
| Task | File cũ → đích | Phần | qc sửa (test khoá, qc xác nhận lại bằng grep) |
|---|---|---|---|
| T7s | `core/process-state.rules.ts` → `domain/runs/run-state.rules.ts` | **toàn file** (một máy trạng thái; enum ⇒ `domain/types`) | `P-a/step0/rules/process-state.test.ts` (R-S18…), mọi `tryLoad("…core/process-state.rules")` |
| T7s | `runs/stage-driver.ts` | `resultOf`, `AgentOut` lỗi job ⇒ `adapters/runs/job-result.ts` | test import `stage-driver` (nếu có) |
| T7s | `runs/team-exec.ts` | `stopFail`, `bump` ⇒ `adapters/runs/team-failure.ts` | — |
| T7s | `runs/team-member.ts` | `reasonOfCode`/`outcomeOf` lỗi ⇒ `adapters/runs/team-failure.ts` | `P-b/pfs4/**` nếu import |
| T7s | `runs/team-counters.ts` | `ensureTeamRun`, `markFailed` ⇒ `adapters/runs/team-run.repo.ts` | `P-b/pfs4/**` nếu import |
| T7s | `runs/sweeps.ts` | `toDecision` (interrupted) ⇒ `application/runs/sweep-interrupted.usecase.ts` | — |
| T8s | `core/task.rules.ts` | `decisionOptionsFor`, `FORCE_USE_CURRENT`, `decisionAssignees` ⇒ `domain/tasks/decision.rules.ts` | `P-a/**/rules/task*.test.ts`, P-c/P-c2 rules gọi `decisionOptionsFor` |
| T8s | `core/step.rules.ts` → `domain/runs/step.rules.ts` | **toàn file** (thuần, 128 dòng) | `P-b2/**/rules/step*.test.ts`, `stepJoin`/`runStatusOf` |
| T8s | `runs/start-inputs.ts` | `shapeValid` + tính `expiresAt` ⇒ `domain/runs/start-inputs.rules.ts` | `P-b/pfs3/rules/**` nếu nạp |
| T8s | `gates/back.effects.ts` | chọn stage reset ⇒ gộp `gates/back.rules.ts` cũ vào `domain/gates/back.rules.ts` | `P-b2/**/back.rules.test.ts` |
| T8s | `runs.repo.countActive` | tập đếm ⇒ `domain/runs/active-cap.rules.ts` | `P-a/pf1/start.int.test.ts` (không đổi đường dẫn) |
| T9s | `notify/reminder.ts`, `notify/notify.rules.ts`, `inbox.repo.{dueTasks,markReminded}` | toàn bộ ⇒ `application/notify/remind-tasks.usecase.ts`, `domain/notify/remind.rules.ts`, `adapters/notify/review-tasks.repo.ts` | R-N02 (`P-a/pf3/rules/notify*`), P3-04 (`P-a/pf3/reminder*`) |
| T9s | `asks/ask.rules.ts` → `domain/asks/forward.rules.ts` | toàn file | `P-a/pf2/rules/ask.test.ts` |
| T9s | `core/task.rules.ts.canAct` → `domain/tasks/task-access.rules.ts` | `canAct` | `P-a/**/rules/task*.test.ts` |
| T10 | `runs/sweeps.expireRuns` | câu đọc ⇒ `adapters/runs/sweep-expire.ts` | — |
| T19s | xem [plan-d2 §8](plan-d2.md) | | |
`run-access.rules`, `isTerminal` dùng chung: domain export lại; file cũ import từ domain (code cũ được import lớp 1). Không shim re-export ở đường dẫn cũ.

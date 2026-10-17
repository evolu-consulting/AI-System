# P-d-durable · plan (backend) — P-d1 + mục lục P-d2 [HUB-FR-143…147][HUB-FR-105/107/109/115][ADM-FR-72/73]

Nối [spec](spec.md) §2–§5, [spec-tz-tools](spec-tz-tools.md), [spec-ca](spec-ca.md), [spec-decisions](spec-decisions.md). Đối chiếu code `platform/gd0` (2026-10-17). `P/` = `apps/hub-api/src/modules/processes/`. Phụ lục: **contract** [plan-contract.md](plan-contract.md) · **DB** [plan-db.md](plan-db.md) · **domain + chữ ký luật** [plan-domain.md](plan-domain.md) · **P-d2** [plan-d2.md](plan-d2.md) (T13). FE: `plan-frontend.md` (T2).

## 0. Quyết định backend (D-PD)
| # | Quyết định | Lý do (code) |
|---|---|---|
| D-PD01 | Thử lại **không** đi qua `transition()`: use case `handleJobFailure` chạy trong tx `runApplyTx`/sweep (run đã khoá) **trước** `eventFor`; `retry` ⇒ ghi hẹn + stage `waiting_timer`; `decide` ⇒ trả lý do cho luồng cũ (`limit` ⇒ `needs_decision`) | Giữ test khoá `transition` (R-S18 chỉ thêm nhánh); một điểm quyết |
| D-PD02 | `retry_count` **reset ngầm**: lưu `retry_attempt/retry_round`; giá trị hiệu lực = `retry_count` khi khớp `(attempt, round)`, khác ⇒ 0 (`effectiveRetryCount`). Launcher chuẩn hoá mỗi lần chạy stage (`markLaunched`) | Không phải sửa các UPDATE `attempt+1`/`round+1` rải ở `team-runner.effects`, `back.effects`, `gates` (PD-R06 không cần tách file lớn) |
| D-PD03 | "Đã gửi `side_effect`" (PD-R05) = ∃ `hub.run_steps` `type IN ('tool','workflow')`, `workflow_id` có `admin.workflows.side_effect`, `status ≠ 'skipped'`, thuộc `hub.runs` có `stage_run_id` = stage ∧ `started_at ≥ stage_runs.retry_since` (lần chạy đầu của attempt/round hiện tại) | Code thật ghi lời gọi tool của agent là `type='tool'` (`mcp.repo.insertToolStep`), không phải `'workflow'` như spec ghi ⇒ gồm cả hai; "đầu attempt/round" cần mốc ⇒ `retry_since` |
| D-PD04 | `add_attempt` của `retry_exhausted`/`timer_invalid` **giữ `attempt`** (như `ask_limit`): stage `queued`, `retry_exhausted` thêm effect `reset_retry`. `tool_failed` (P-d2) ⇒ như `agent_failed` (attempt+1) | D3 "attempt giữ nghĩa làm lại do góp ý" |
| D-PD05 | `timer_invalid` + `use_current` không cần output: domain trả effect `write_wait_skip` (ghi .md "Bỏ chờ theo quyết định" + `## Bàn giao`) trước khi advance | PD-R14 + readiness #14 |
| D-PD06 | Output Hub sinh (wait_until P-d1) dùng lại `runs/apply-settle.settleApply` (ghi `process_outputs` inline, join bước) qua port `StageSettler` — chỉ lời gọi | Đã có cho stage Áp (P-c2), không blob |
| D-PD07 | `process_timers.timezone` lưu IANA lúc lưu hẹn `wait_until` | Câu .md "(…{timezone})" + `StageView.wait.timezone` không phải đọc lại tenant (B7) |
| D-PD08 | Trần: tập riêng `PROCESS_RUN_CAP_COUNTED` (4 trạng thái cũ); `PROCESS_RUN_ACTIVE` += `waiting_timer` (= "chưa kết thúc") | `process_runs_active_idx` giữ predicate; expire/isActive thấy run chờ |
| D-PD09 | Hẹn `due_at ≤ now` vẫn ghi hàng hẹn, bắn ở lượt quét kế (≤ 3 s) | Một đường duy nhất, idempotent |
| D-PD10 | Vòng hẹn giờ trong `sweepOnce` (3 s); **thêm vòng nhắc chạy thật** `startProcessReminder` 300 s ở mount (hiện `remindOnce` chỉ có qua handle — không có vòng production) | PD-R18 "trễ ≤ 5 phút" cần vòng thật |
| D-PD11 | Editor đọc múi giờ (và P-d2: tool khả dụng) qua `GET /process-editor/context` | B3: không mở màn tenant cho tenant_admin |
| D-PD12 | Mã `VALIDATION_ERROR` = **400** (contract `common.ts:210`, `chat/errors.ts:9`); spec/AC ghi "422" cho input `date`/`timezone` là lệch ⇒ theo contract (§10 Q1) | Không đổi mã contract đã khoá |
| D-PD13 | Không có export/import def trong code ⇒ PD-R24 phần export/import N/A | grep `transfer.ts`, `defs.routes.ts` |

## 1. Đặt file theo lớp — P-d1 (ADR-0023, spec-ca §2; tên file đích giữ, thêm vài file)
| Lớp | File mới | Nội dung |
|---|---|---|
| 1 | `domain/types.ts`, `domain/limits.ts`, `domain/errors.ts`, `domain/defs/def-shape.ts` | [plan-domain §1–3](plan-domain.md) |
| 1 | `domain/runs/{job-error,retry,run-state,step,active-cap,start-inputs,team-retry}.rules.ts` | §4.1–4.5, 4.9 + `teamResumePlan` (§4.3 dưới) |
| 1 | `domain/timers/{timer-key,timer,due-at}.rules.ts` | §4.10–4.12 |
| 1 | `domain/defs/{wait-def,escalate-def,ttl}.rules.ts` · `domain/notify/{remind,escalate}.rules.ts` · `domain/asks/forward.rules.ts` · `domain/tasks/{decision,task-access}.rules.ts` | §4.6–4.8, 4.13–4.16 |
| 2 | `application/ports.ts` | §3 dưới |
| 2 | `application/runs/{handle-job-failure,sweep-interrupted}.usecase.ts` | §4.2–4.4 |
| 2 | `application/timers/{enter-wait,fire-timer,cancel-timers}.usecase.ts` | §4.6, 4.8 |
| 2 | `application/notify/{remind-tasks,escalate-task}.usecase.ts` | §4.9 |
| 3 | `adapters/hub-uow.ts` (`createHubUow`, `bindTx`), `adapters/outbox.ts` (Notifier/StageKicker sau COMMIT) | §3 |
| 3 | `adapters/runs/{retry.repo,side-effect.repo,team-run.repo,team-failure,durable-effects}.ts` | retry, probe PD-R05, team pause/resume, `durableBefore/After` |
| 3 | `adapters/timers/{timers.repo,timer-sweep,tenant-tz.repo,stage-settler}.ts` | hẹn giờ, quét, đọc `admin.tenants.timezone`, gọi `settleApply` |
| 3 | `adapters/notify/{review-tasks.repo,escalation.repo,reminder-loop}.ts` | nhắc/chuyển cấp |
| 3 | `adapters/defs/{durable-def,editor-context.routes}.ts` | map def → `StageShape`, `ensureWaitStage`, ref Group, route §4 contract |
| 3 | `adapters/processes.mapper.ts` (+`.test.ts`), `adapters/assert-equal.ts` | [plan-domain §6](plan-domain.md) |
| 4 | `processes.mount.ts` | dựng `uow`, `clock`, `ids`, `outbox`; vòng nhắc; route editor-context |
File cũ chỉ thêm **lời gọi** (CA-R01): `runs/stage-driver.ts`, `runs/launcher.ts` (nhánh `wait_until`, `markLaunched`), `runs/team-exec.ts` (cờ `noCountFirst`), `runs/executor-ref.ts` (`WAIT_UNTIL_EXECUTOR_REF`), `runs/view-steps.ts` (trường view), `runs/runs.repo.ts` (`countActive` dùng `CAP_COUNTED`), `team-runner.effects` + `gates/gates.effects.ts` (`durableBefore/After`), `gates/back.effects.ts` (huỷ hẹn), `defs/def.rules.ts` + `defs/defs.service.ts` (gọi luật/ép stage/ttl), `core/task-view.ts` + `gates/gates.repo.ts` (nạp Group chuyển cấp). Hẹn giờ/chuyển cấp gộp trong handle `sweepOnce`/`remindOnce` sẵn có (không thêm handle).

## 2. Kích thước
Lớp 1 ≤ 150 dòng/file; use case ≤ 120; repo ≤ 200; gốc `processes/` ≤ 10 mục.

## 3. Port + UnitOfWork (`P/application/ports.ts`, lớp 2 — chỉ kiểu)
```ts
export type Clock = { now(): Date };                 // adapter bọc `ProcessDeps.now` (seam AppDeps.now)
export type IdGen = { newId(): string };             // crypto.randomUUID ở adapter
export type Logger = { warn(m: string, f?: Record<string, unknown>): void; error(m: string, f?: Record<string, unknown>): void };
export type OutboxEvent =
  | { kind: "process_updated"; runId: string }       // adapter tự nạp recipients + status (như processUpdated)
  | { kind: "kick"; runId: string } | { kind: "post_thread"; runId: string }
  | { kind: "user_events"; events: readonly unknown[] };   // UserEvent đã dựng bởi code cũ (đi xuyên, không đọc)
/** Gom sự kiện trong tx; adapter phát SAU COMMIT, đúng một lần (bỏ gom của lần chạy lại 40P01/40001). */
export type Outbox = { emit(e: OutboxEvent): void };
export type TxRepos = { tenantId: string; retry: RetryRepo; sideEffect: SideEffectProbe; team: TeamRunRepo;
  timers: TimerRepo; stages: StageRepo; runs: RunRepo; tz: TenantTzReader; settle: StageSettler;
  reviewTasks: ReviewTaskRepo; groups: GroupReader; audit: AuditWriter; notices: NoticeWriter; outbox: Outbox };
export type UnitOfWork = {
  /** Request người dùng: withHubScope({kind:"user", tenantId, userId}). */
  tenant<T>(who: { tenantId: string; userId: string }, fn: (r: TxRepos) => Promise<T>): Promise<T>;
  /** Vòng nền: withHubScope({kind:"system"}) — repo đã gắn `tenantId`, MỌI câu lọc tenant_id tường minh. */
  system<T>(tenantId: string, fn: (r: TxRepos) => Promise<T>): Promise<T>;
};
export type AppCtx = { clock: Clock; ids: IdGen; log: Logger };
```
Repo port (mọi phương thức đã gắn `tenantId` của UoW, **không** nhận `Tx`): `RetryRepo.{loadRetryState(stageRunId), markWaiting(stageRunId, p), resetRetry(stageRunId)}` · `SideEffectProbe.sent(stageRunId): Promise<boolean>` · `TeamRunRepo.{pauseForRetry(teamRunId, cursor, now), markFailed(teamRunId)}` · `TimerRepo.{countByStageKind, insert, lockById, markFired, cancel, cancelForRun(runId, stageRunIds|"all", now), stageTimerKind(stageRunId)}` · `StageRepo.{byId, setQueued, setStatus}` · `RunRepo.{lock(runId), head(runId), setStatus(runId, s)}` · `TenantTzReader.read(): Promise<string>` · `StageSettler.settleDone(runId, stageRunId, md)` · `ReviewTaskRepo.{applyTiming, dueReminders, markReminded, dueEscalations, markEscalated}` · `GroupReader.tenantOf(groupId)` · `AuditWriter.write(a)` · `NoticeWriter.insert(...)`.
`adapters/hub-uow.ts`: `createHubUow(db, deps)` dựng repo bằng `makeRepos(tx, tenantId, outbox)`; `bindTx(tx, tenantId)` cho **code cũ đang ở trong tx** (launcher, stage-driver, gates) gọi use case rồi tự xả outbox sau COMMIT của nó (trả `events` như mẫu `effects`). Use case export hai dạng: `xxx(ctx, r, input)` (lõi, nhận `TxRepos`) và `xxxTx(ctx, uow, input)` (bọc UoW).

## 4. Luồng P-d1
### 4.1 Phân loại lỗi — điểm gọi `classifyJobError`
| Nguồn lỗi | Lấy `code`/`reason` | Ghi chú |
|---|---|---|
| Stage agent: `runJob` ⇒ `JobOutcome.failed{code, reason}` | `AgentOut.jobReason` đổi thành `job: {code, reason}` (stage-driver, tách T7s) | `aborted` ⇒ `interrupted` (tạm) |
| Thành viên nhóm: `MemberResult` | thêm `job: {code, reason} \| null` vào `MemberResult` (team-member, T7s) | `not_configured` (thiếu agent) ⇒ code `NOT_CONFIGURED` ⇒ nghiệp vụ (TM-08 giữ) |
| Vòng quét D11 | `interrupted` | tạm, không qua hàm |
| #134 `failStuckRun` | — | giữ `agent_failed` nghiệp vụ (lỗi lạ trong Hub) |
| Stage `apply` | — | không áp (PD-R09) |
Bảng code×reason đầy đủ: [plan-domain §4.1](plan-domain.md).

### 4.2 Thử lại stage agent (PD-R03/R04/R06)
Trong `runApplyTx` (scope system, run **đã khoá**), khi `x.result.kind = failed` hoặc `limit/interrupted`:
1. `st = r.retry.loadRetryState(stageRunId)` (lọc `id, tenant_id`); stage phải `running` ∧ `current_run_id = hubRunId` (đã kiểm ở `lockAndLoad`).
2. `cls = interrupted ? "transient" : classifyJobError(code, reason)`; `sideEffectSent = cls==="transient" && await r.sideEffect.sent(stageRunId)` (D-PD03).
3. `dec = decideRetry({cls, state: st, sideEffectSent, legacy: legacyFailReason(...), now})`.
4. `retry` ⇒ `n = timers.countByStageKind(stageRunId,"retry") + 1`; `key = timerKey({kind:"retry", stageRunId, round, attempt, n})`; `retry.markWaiting(stageRunId, {retryCount, attempt, round, lastErrorCode: code ?? "INTERRUPTED", status:"waiting_timer", currentRunId: null})`; `timers.insert({kind:"retry", dueAt, key, timezone:null})`; `runs.setStatus(runId, runStatusOf(statusForRun(...)))` (stage retry tính như `queued` ⇒ run `running`, Q7); `outbox.emit(process_updated)`. Trả `{kind:"retry"}` ⇒ stage-driver **bỏ** `transition`, vẫn `finish()` đóng `hub.runs` failed như cũ, không `kick`.
5. `decide` ⇒ `eventFor` trả `{kind:"limit", reason: dec.reason}` (lý do cũ hoặc `retry_exhausted`) ⇒ luồng cũ.
Bắn hẹn `retry` ⇒ `fire-timer` (§4.6) ⇒ stage `queued` ⇒ `kick` ⇒ launcher tạo job mới **cùng attempt/round**, kiểm lại quyền/`starterUsable` như mọi lần (HUB-BR-27). `markLaunched` (launcher, sau UPDATE `running`): `retry_since = CASE WHEN (retry_attempt, retry_round) IS DISTINCT FROM (attempt, round) OR retry_since IS NULL THEN $now ELSE retry_since END`, `retry_count = CASE … THEN 0 ELSE retry_count END`, `retry_attempt = attempt`, `retry_round = round`.
`add_attempt` của `retry_exhausted` ⇒ effect `reset_retry` (`durableBefore`): `retry_count = 0, last_error_code = NULL` (giữ `retry_since`).

### 4.3 Thử lại stage team (PD-R08, Q1)
- `team-exec.stopFail` (dời sang `adapters/runs/team-failure.ts` ở T7s) **không** `markFailed` nữa; trả `StageResult.failed` kèm `job` + `team: {teamRunId, cursor}` (`cursor` = chỉ số thành viên lỗi trong danh sách đang chạy; lead lỗi ⇒ `-1`).
- `handleJobFailure` (team): `retry` ⇒ thêm `team.pauseForRetry(teamRunId, cursor, now)`: `status` giữ `running`, `active_ms += max(0, now − segment_started_at)` (đồng hồ `Clock`, không `now()` SQL), `segment_started_at = NULL`, `cursor = max(cursor,0)`, `plan` giữ. `decide` ⇒ `team.markFailed` (trong cùng tx — thay cho lời gọi cũ ngoài tx).
- Bắn ⇒ stage `queued` ⇒ launcher ⇒ `runTeamStage` ⇒ `ensureTeamRun` (dời `adapters/runs/team-run.repo.ts` T7s) dùng `teamResumePlan(cur)`: `waiting_answer` ⇒ resume (cũ); `running ∧ segment_started_at IS NULL` ⇒ **resume retry** (`segment_started_at = now`, cursor giữ); còn lại ⇒ mới.
- Gọi lại không tăng `calls`: `sequential` ⇒ chạy từ `cursor`, lần gọi đầu `noCountFirst`; `lead_plan` ⇒ có `plan` đã lưu ⇒ tuần tự theo plan từ `cursor` (lần đầu không đếm), chưa có plan (lead lỗi) ⇒ gọi lại lead không đếm; `parallel_merge` ⇒ gọi lại **mọi** thành viên của lượt, không đếm lượt gọi lại (§10 Q2).
- Thử lại dùng chung `retry_count` stage; khoá idempotency theo `stage_run_id` (§4.2 bước 4).

### 4.4 `interrupted` (vòng quét D11)
`sweeps.toDecision` (dời `application/runs/sweep-interrupted.usecase.ts` T7s, scope system qua `uow.system(tenantId)`): khoá run → stage `running` (đọc lại, lọc `tenant_id` — sửa `stageById` thiếu lọc tenant) → `handleJobFailure({interrupted:true})` → `decide` ⇒ needs_decision với `dec.reason` (`interrupted` hoặc `retry_exhausted`) thay vì hằng `interrupted`.

### 4.5 `waiting_timer` + trạng thái run + trần (PD-R15/R16)
- Stage → `waiting_timer` luôn kèm hàng hẹn chưa bắn (một hẹn mở/stage — kiểm bằng `timers.stageTimerKind`).
- Trạng thái run sau mọi đổi stage của bước hiện tại = `runStatusOf(stages.map(s ⇒ statusForRun(s.status, timerKind(s))))` ([plan-domain §4.4](plan-domain.md)); run `waiting_timer` chỉ khi mọi stage chưa xong đều chờ `wait_until`.
- `countActive` (`runs.repo.ts`) dùng `CAP_COUNTED`; run tỉnh dậy không qua `createRun` ⇒ không bị trần. `expireRuns` dùng `isActive` (5 trạng thái) + `expires_at IS NOT NULL`.

### 4.6 `wait_until` (PD-R13/R14/R17)
**Vào** (launcher `plan()`, tx scope user người bắt đầu, run đã khoá; sau `starterUsable`): `if (def.executor.kind === "wait_until") return enterWait(...)` (lời gọi qua `bindTx`):
1. Ngày gốc: `from.input` ⇒ `process_runs.inputs[key]` (`type='date'`); `from.field` ⇒ `process_outputs.fields->>field` của output hiện hành (`current_output_id`) của stage `stage_key` (bước nhỏ hơn); stage nguồn `skipped`/không output ⇒ `null`.
2. `tz = r.tz.read()` (`SELECT timezone FROM admin.tenants WHERE id = $tenantId`, trong tx; không có hàng ⇒ `TENANT_TZ_DEFAULT` + log warn).
3. `w = waitDueAt({base, offsetDays, time, tz, now, expiresAt})`. `ok` ⇒ hẹn `wait_until` (`timezone = tz`, khoá `n`), stage `waiting_timer` + `started_at`, trạng thái run (§4.5), outbox `process_updated` + `post_thread`. Không `ok` ⇒ `toDecision(timer_invalid)` (hàm cũ `team-runner.toDecision`; người quyết như `agent_failed`).
**Bắn** (`fire-timer`, §5): khoá run → khoá hẹn → `fireAction(kind, stage.status, terminal)`: `requeue` ⇒ `markFired`, stage `queued` (`current_run_id = NULL`), trạng thái run, outbox `kick`+`process_updated`; `finish_wait` ⇒ `markFired`, `settle.settleDone(runId, stageRunId, waitOutputMd(name, waitedText(dueAt, timer.timezone)))` (= `settleApply` outcome `done` ⇒ stage done + join bước như P-b2), outbox sự kiện/kick theo kết quả; `drop` ⇒ `cancel`.
**Quyết** `timer_invalid`: `add_attempt` ⇒ stage `queued` ⇒ launcher tính lại; `use_current` ⇒ `write_wait_skip` ghi .md `WAIT_SKIP_TEXT` rồi advance; `cancel` như cũ. `decisionOptionsFor`: `timer_invalid ∈ FORCE_USE_CURRENT`.
**Lưu def**: `defs.service` gọi `waitStageIssues` + `ensureWaitStage` (plan-contract §3); ExecutorRef `WAIT_UNTIL_EXECUTOR_REF`.

### 4.7 Giờ địa phương → UTC theo IANA, không thư viện (TZ-R04)
`offsetAt(instantMs, tz)` = (giờ tường của `instantMs` ở `tz` đọc bằng `new Intl.DateTimeFormat("en-US", {timeZone: tz, hourCycle:"h23", year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit", second:"2-digit"}).formatToParts(new Date(instantMs))`, dựng lại bằng `Date.UTC`) − `instantMs`.
`localToUtc(date, time, tz)`: `g = Date.UTC(y, m−1, d, hh, mm)`; `o1 = offsetAt(g − 86_400_000, tz)`, `o2 = offsetAt(g + 86_400_000, tz)`; ứng viên `c1 = g − o1`, `c2 = g − o2`; giữ ứng viên có `wallClockOf(c) = (date, time)`; ≥ 1 ⇒ **sớm nhất** (giờ lặp lúc lùi giờ ⇒ lần đầu); 0 (giờ rơi vào khe tiến giờ) ⇒ `c1` (offset trước chuyển ⇒ giờ tường dịch tới sau khe). `formatToParts` không tham số "now" ⇒ tất định (CA-R05).
Test bắt buộc (qc, lớp 1): `Asia/Ho_Chi_Minh` 09:00 ⇒ 02:00Z; `Europe/Berlin` 2026-03-29 09:00 ⇒ 07:00Z (CEST), 2026-03-28 09:00 ⇒ 08:00Z; khe `Europe/Berlin` 2026-03-29 02:30 ⇒ 01:30Z (= 03:30 CEST); lặp 2026-10-25 02:30 ⇒ 00:30Z (lần đầu, CEST); `America/New_York` 2026-11-01 01:30 ⇒ 05:30Z; `Australia/Lord_Howe` (lệch 30') 2026-04-05 01:45; ngày ±365 qua năm nhuận 2028-02-29; `offset_days` âm qua đầu tháng.

### 4.8 Huỷ hẹn (PD-R12) — cùng tx, run đã khoá (thứ tự run → stage → timer)
| Điểm | Gọi | Phạm vi |
|---|---|---|
| `transition` effect `cancel_stage_run`/`finish_run` (huỷ, quyết `cancel`, kết thúc) | `durableAfter` (team-runner.effects, gates.effects) | `cancelForRun(runId, "all")` |
| `sweeps.endRun` (hết hạn) | lời gọi `cancelTimers` | `"all"` |
| `back.effects.applyBack` | `stagesToCancelOnBack(stages, toStep)` | stage bị reset |
| P-d2 nhánh nhảy | `skippedStages` | stage bị `skipped` |
`cancel` = `UPDATE … SET cancelled_at = $now WHERE tenant_id = $t AND process_run_id = $r AND fired_at IS NULL AND cancelled_at IS NULL [AND stage_run_id = ANY($ids)]`.

### 4.9 Nhắc lặp + chuyển cấp (PD-R18…R22)
- **Tạo task review** (effect `open_review`, `durableAfter`): `applyTiming(taskId, reviewTaskTiming(now, cfg))` với `cfg` lấy từ **snapshot** stage (`after.remind_every_h`, `after.escalate`). Không cấu hình ⇒ `remind_at = created + 24 h` như cũ, `remind_count = 0`.
- **Vòng nhắc** (`remind-tasks.usecase`, chạy bởi `startProcessReminder` 300 s + handle `remindOnce`): đọc ứng viên scope system **không khoá** (`review_tasks_remind_due_idx`, `LIMIT 100`), mỗi hàng `uow.system(tenantId)`: guard `UPDATE review_tasks SET … WHERE id=$id AND tenant_id=$t AND status='open' AND <điều kiện dueReminder> RETURNING` (0 hàng ⇒ bỏ); cũ ⇒ `reminded_at = now`; lặp ⇒ `nextRemind` + `reminded_at = now`. Người nhận = mọi assignee (user + mọi Group, gồm Group chuyển cấp) qua `noticeRecipients`. Notice `reminder` như cũ.
- **Chuyển cấp** (`escalate-task.usecase`, cùng vòng nhắc, sau nhắc): ứng viên `review_tasks_escalate_idx`; mỗi hàng `uow.system(tenantId)`: guard `UPDATE review_tasks SET escalated_at=$now WHERE id AND tenant_id AND kind='review' AND status='open' AND escalated_at IS NULL AND escalate_at <= $now RETURNING escalate_group_id`; `escalateAction({groupId, groupExists, groupTenantId: groups.tenantOf(groupId), taskTenantId})` ⇒ `add_group`: INSERT `review_task_assignees (tenant_id=$t, task_id, group_id, via='escalated')`, audit `escalate` (entity `review_task`, actor hệ thống, `details {from_group, to_group}`), notice `escalated` cho thành viên Group mới (`groupMemberIds(tenant, group)`), sự kiện sau COMMIT; `skip` ⇒ audit `escalate_skipped`. Không khoá run (tx chỉ chạm `review_tasks → assignees → notices → audit`, đúng thứ tự P-a §10).
- **Quyết/xem sau chuyển cấp**: `canAct` (dời `domain/tasks/task-access.rules.ts` T9s) nhận `extraGroupIds`; loader `core/task-view.ts`, `gates/gates.repo.ts` nạp Group `via='escalated'`. Xem ngoài phòng: `hub.process_run_viewer` (0019 dòng 583) đã xét assignee Group ⇒ không đổi SQL. Forward: `forwardCheck` với `escalatedGroupId` + `byGroupIds`.
- Lưu def: `escalateStageIssues` (422 `ESCALATE_INVALID`) + `escalateGroupRefs` ∉ `DefRefs.groupIds` (Group của **tenant def**) ⇒ 422 `PROCESS_REF_INVALID {path:"stages.<i>.after.escalate.group_id", ref:"group"}`.

### 4.10 `ttl_days` (PD-R24/R25)
`defs.service` create/update/copy dùng `ttlOnCreate`/`ttlOnUpdate`; `defs.repo` cột `ttl_days`; start: snapshot `ttl_days`, `expires_at = expiresAt(now, ttl)` (thay `PROCESS_RUN_TTL_DAYS` trong `start-inputs.createRun` — phần tính dời domain ở T8s). Run đang chạy không đổi khi sửa def.

### 4.11 Múi giờ tenant — admin-api (T6a, không tách lớp)
`tenants.repo` đọc/ghi cột; `tenants.service.updateTenant` thêm `timezone` vào diff audit (before/after) + `config_changed`; `transfer` (`TenantElSchema`, `transfer.write`) đọc/ghi `timezone` (vắng ⇒ giữ / mặc định). `tenant_admin` ⇒ 403 sẵn có (`requireRole("platform_admin")`).

## 5. Vòng nền (CA-R06)
| Vòng | Runner (lớp 4) | Đọc ứng viên (lớp 3, system, không khoá) | Mỗi hàng (lớp 2 trong `uow.system(tenantId)`) |
|---|---|---|---|
| Hẹn giờ | `sweepOnce` (3 s, `startLoop` chặn chồng lượt) gọi `fireDueTimers` **đầu tiên** | `select id, tenant_id, process_run_id from hub.process_timers where fired_at is null and cancelled_at is null and due_at <= $now order by due_at limit 100` | `fireTimer`: `runs.lock(runId)` (`… where id=$r and tenant_id=$t for update`) → `timers.lockById(id)` (`… where id=$i and tenant_id=$t and process_run_id=$r for update`) → kiểm lại `fired_at/cancelled_at IS NULL` → hiệu ứng §4.6. Lỗi một hàng ⇒ log `process-timer-fire-failed`, tiếp hàng khác |
| `interrupted` | `sweepOnce` (sẵn có) | `scanDue` (giữ, đã lọc tenant ở join) | `sweep-interrupted` §4.4 |
| Hết hạn | `sweepOnce` | `expireRuns` (+ `expires_at IS NOT NULL`) | `endRun` + huỷ hẹn |
| Nhắc + chuyển cấp | `startProcessReminder` (300 s, mount, `processLoops !== false`) | §4.9 | §4.9 |
Hai instance quét song song: hàng thứ hai chờ khoá run, đọc lại thấy `fired_at` ⇒ bỏ (S4). Regression `scanDue` P-c2 (D1 `c5e9b6b8`): mọi câu trong tx **có** `tenant_id = $t` dù scope `system` (policy `v_t` cho system thấy mọi tenant) — reviewer grep `adapters/**` (§7 K3).

## 6. Khoá, giao dịch, đồng thời
Thứ tự P-a §10 + P-b2 §7 giữ; thêm `process_timers` **sau** `stage_runs`, trước `review_tasks`: `process_runs → stage_runs → process_timers → team_runs → review_tasks → assignees → notices → thread → audit`. Không đường nào khoá timer trước run.
| Đua | Kết quả (int test qc) |
|---|---|
| 2 `sweepOnce` cùng bắn một hẹn | đúng 1 `fired_at`, 1 job/1 output (AC-H41) |
| Hẹn `retry` bắn ∥ huỷ run | huỷ thắng ⇒ hẹn `cancelled_at`; hoặc bắn trước ⇒ stage `queued` rồi bị huỷ; không hồi sinh |
| Hẹn `wait_until` bắn ∥ quay lại bước | quay lại khoá run trước ⇒ hẹn huỷ ⇒ bắn đọc lại thấy `cancelled_at` ⇒ bỏ |
| Job lỗi muộn sau khi stage đã `waiting_timer` | `current_run_id = NULL` ⇒ `lockAndLoad` bỏ |
| Nhắc ∥ Đạt | guard `status='open'` ⇒ 0 hàng ⇒ không notice |
| Chuyển cấp ∥ Đạt | Đạt trước ⇒ guard 0 hàng; chuyển cấp trước ⇒ assignee thêm vào task sẽ đóng (vô hại) |
| Hai instance chuyển cấp | guard `escalated_at IS NULL` ⇒ một lần |
| `retry` 40P01 | outbox của lần hỏng bị bỏ; khoá `n` đếm lại dưới khoá run |

## 7. Bảo mật — điểm security review (hard stop tenant)
| # | Chỗ | Kiểm cụ thể | Khi |
|---|---|---|---|
| K1 | `adapters/hub-uow.ts` | `tenant()` ⇒ `withHubScope({kind:"user"})`; `system()` chỉ vòng nền/driver; repo **luôn** nhận `tenantId` từ UoW (không tham số từ caller); không type nào ở lớp 2 chứa `Tx`; outbox xả **sau** COMMIT, một lần, bỏ gom khi tx chạy lại; lỗi publish không rollback | T6c |
| K2 | `bindTx` | chỉ adapter/code cũ gọi; `tenantId` lấy từ hàng đã khoá (`head.tenant_id`), không từ input người dùng | T6c, T7 |
| K3 | Vòng hẹn giờ/nhắc/chuyển cấp (S1) | mọi `select/update/insert` trong tx có `tenant_id = $t`; khoá theo `(id, tenant_id)`; test 2 tenant cùng tới hạn qua **use case thật** (AC-H46); so khuôn `scanDue` | T8, T9, T12 |
| K4 | Chuyển cấp (S2) | Group đích cùng tenant ở **lưu** (`DefRefs` của tenant def) **và** lúc chuyển (`groups.tenantOf = task.tenant_id`); assignee `tenant_id` = task; grant gắn task (HUB-BR-25, viewer `task` không thấy input/history); audit đủ; forward chỉ trong Group người chuyển | T9, T12 |
| K5 | `TenantTzReader` | chỉ đọc `admin.tenants` theo `tenant_id` của run; không nhận tz từ client | T8 |
| K6 | Side effect (S3) | probe lọc `tenant_id` của stage; `admin.workflows` join theo `workflow_id`; nghi ngờ (lỗi truy vấn) ⇒ coi như **đã gửi** (không thử lại) | T7 |
| K7 | FK kép + RLS `process_timers` | `hub_rw` user tenant B 0 hàng của A; INSERT `stage_run_id` tenant khác ⇒ FK lỗi | T6, T12 |
| K8 | P-d2 công tắc tool, danh tính người bắt đầu | [plan-d2 §7](plan-d2.md) | T20 |

## 8. Tách file cũ (task `Ns`) — bảng đầy đủ ở [plan-domain §7](plan-domain.md)
Tóm tắt: T7s dời `core/process-state.rules.ts` (toàn file), phần lỗi job của `stage-driver`/`team-exec`/`team-member`/`team-counters`, `sweeps.toDecision`; T8s dời `core/step.rules.ts` (toàn file), phần quyết của `core/task.rules.ts`, phần thuần `start-inputs`, chọn stage reset của `back.effects`, tập đếm trần; T9s dời nhắc (`reminder`, `notify.rules`, `dueTasks`), `asks/ask.rules.ts`, `canAct`; T19s ở plan-d2 §8. Mỗi `Ns` đi cùng `Nq` (qc sửa đường dẫn test khoá + lock, không shim).

## 9. Ước lượng diff (≤ 400 dòng/task, không tính test/migration) + rủi ro
| Task | Diff | Rủi ro · model | Ghi chú |
|---|---|---|---|
| T5 contract P-d1 | ~180 | cao · Opus | §1–§4 contract |
| T6 DDL 0036 + Drizzle | ~60 (+SQL ~130) | cao · Opus | |
| T6a múi giờ admin | ~120 | cao · Opus | |
| T6b khung 4 lớp | ~300 | cao · Opus | ports, uow, outbox, mapper + test |
| T7s / T7 | ~300 / ~350 | cao · Opus | T7 lớn nhất: chia T7a (agent + interrupted) / T7b (team) nếu > 400 |
| T8s / T8 | ~250 / ~380 | cao · Opus | T8 chia T8a (wait_until + TZ + view) / T8b (vòng hẹn giờ + huỷ) nếu > 400 |
| T9s / T9 | ~220 / ~320 | cao · Opus | |
| T10 | ~120 | thường · Sonnet | |
Thứ tự: T5 → T6 → T6a ∥ T6b → T6c → T7s → T7 → T8s → T8 → T9s → T9 → T10 → T11 (FE) → T12. Rủi ro lớn: (R1) sót điểm gọi lỗi job ⇒ stage kẹt `waiting_timer` không hẹn — test int mỗi đường §4.1; (R2) đồng hồ: `team-counters` dùng `now()` SQL — tính `active_ms` khi pause dùng `Clock`; (R3) danh sách `Intl.supportedValuesOf` khác giữa Chrome và Bun/JSC (Bun 1.4.3: 445 vùng, không có `Asia/Saigon`) ⇒ chỉ kiểm IANA ở schema **request** (server), response dùng chuỗi thường; FE luôn hiện giá trị hiện tại + mặc định trong ô chọn; (R4) dời file làm đỏ test khoá ⇒ Nq cùng lúc.

## 10. Khép readiness lần 1 + câu hỏi
#1 (BE) plan + 4 phụ lục · #3 plan-domain §4.1 + §4.1 · #4 D-PD03, §4.2, K6 · #5 §4.3, Q2 · #6 thay bằng công tắc tenant (plan-d2 §3–5) · #7 plan-contract §3 (`ensureWaitStage`), plan-d2 §3 · #8 plan-contract §2, plan-d2 §10 · #9 §4.2 bước 4, plan-domain §4.10 · #10 §5, §6 · #11 plan-db §1 · #12 plan-db §1/§3, plan-contract §2/§6 · #13 §4.9, plan-contract §7, plan-d2 §3 · #14 D-PD05, plan-domain §4.3/§4.16, plan-d2 §3 · #15 §4.6 bước 1, plan-domain §4.6 · #16 plan-contract §1, plan-domain §4.9, Q1 · #17 §4.5 (AC đã sửa ở spec-ac) · #18 điều kiện Gate T4/T16 · #20 §4.5, plan-domain §4.4 · #21 §4.9, D-PD10 · #22 plan-domain §7 cột qc · #23 D-PD13, plan-contract §5 · #24 plan-contract §1, plan-domain §4.12 · #25 plan-domain §7 T9s (`asks/{asks.service,asks.repo}` chỉ lời gọi) · #26 plan-d2 D2-01/D2-03.

**Câu hỏi (mặc định đề xuất — dùng nếu không trả lời):**
- **Q1** · Spec/AC ghi "422 `VALIDATION_ERROR`" cho input `date` sai và `timezone` sai, nhưng contract khoá `VALIDATION_ERROR = 400` (`common.ts:210`, `chat/errors.ts:9`). **Mặc định:** giữ 400 (mã + path như spec); qc viết AC-H41/AC-A14 theo 400; docs-architect sửa câu chữ spec-tz-tools TZ-R02, spec PD-R13, spec-ac.
- **Q2** · Thử lại thành viên ở chế độ `lead_plan`/`parallel_merge` (Q1 chỉ định nghĩa "thành viên ở `cursor`"). **Mặc định:** §4.3 (lead_plan theo plan đã lưu; parallel_merge gọi lại cả lượt, không đếm `calls`).
- **Q3** · TT-R03 ghi audit `workflow_tool.enable/disable`; audit admin tách `entity`+`action` với enum khoá. **Mặc định:** `entity:"workflow"`, `action:"grant"/"revoke"`, `tenant_id`=tenant (plan-contract §6) — không thêm enum.

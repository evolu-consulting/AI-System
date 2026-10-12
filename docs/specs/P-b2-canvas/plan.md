# P-b2-canvas · plan (backend) — bước song song + quay lại + Bàn giao/resume [HUB-FR-104][HUB-FR-106][HUB-FR-118][HUB-FR-136]

Nối spec §2 (PB2-R), §3, §4 · quyết định Gate/mặc định: [spec-decisions.md](spec-decisions.md). Đối chiếu code `apps/hub-api/src/modules/processes/**` tại `b1cb2c86`. FE: `plan-frontend.md`.

## 0. Quyết định backend (D1–D12)
| # | Quyết định | Lý do (code) |
|---|---|---|
| D1 | `transition()` (`core/process-state.rules.ts`) **giữ nguyên** = máy trạng thái **một stage**. Bước song song là lớp mới `core/step.rules.ts` (join + trạng thái run tổng hợp). Người gọi dựng `RunState.status` từ **trạng thái stage** (`stageGateStatus`), `stageIdx/stageCount` = bước/tổng bước | Không vỡ test khoá P-a của `transition`; cổng `ACCEPTS` hiện đối chiếu `run.status` — với song song run có thể `needs_decision` trong khi stage kia `waiting_review` |
| D2 | `process_runs.status` = **tổng hợp** trạng thái các stage của bước hiện tại (`runStatusOf`): `needs_decision` > `running` (pending/queued/running) > `waiting_answer` > `waiting_review` | Một trạng thái run cho inbox/quota/sweep; PB2-R04 "một stage cần quyết ⇒ run cần quyết" |
| D3 | Mọi guard `run.status === 'running'` trong engine đổi thành "run **không kết thúc** ∧ stage đúng trạng thái". Engine lấy `idx` từ **`stage_run_id` của job/task**, không từ `current_stage_idx` | `stage-driver.runApplyTx`, `launcher.kick/plan`, `sweeps`, `stage-sources`, `team-exec`, `resolve-apply` đang đọc `current_stage_idx` |
| D4 | `current_stage_idx` giữ = **stage nhỏ nhất của bước hiện tại** (tương thích summary/thread); `current_step` là nguồn thật | PB2-R14 |
| D5 | Launcher: một `kick` khởi động **lần lượt** mọi stage `queued` của bước hiện tại — mỗi stage một tx (khoá run như cũ), lặp tới khi `skip` (≤ 4 vòng) | Giữ nguyên `plan()`/`launchStage()` + idempotent `current_run_id`; không gộp `createRunTx` nhiều lần trong một tx |
| D6 | Đạt / `use_current` chỉ đóng task mở **của chính stage_run** (`closeOpenTasks` thêm `stageRunId`); huỷ/hết hạn/quay lại vẫn đóng cả run | Hiện `pass` đóng MỌI task mở của run ⇒ với song song sẽ `superseded` nhầm thẻ duyệt stage kia |
| D7 | Làm rõ PB2-R07: bước X ⇒ `queued`; bước > X ⇒ `pending`; `round+1` chỉ cho stage **đã từng chạy** (status ≠ `pending`); reset `attempt=1`, `attempt_limit=4`, `asks_count=0`, `ask_limit=3`, `template_failures=0`, `current_run_id=NULL`, `current_output_id=NULL`, `passed_by/at=NULL`, `back_to_step=NULL`, `redo_sections=NULL`; `feedback` = góp ý (bước X) / NULL (bước > X) | Bước > X không được launch trước khi X xong; ×lần chỉ đúng khi stage đã chạy |
| D8 | Quá trần quay lại: stage nguồn `needs_decision(back_limit)`, lưu đích ở `stage_runs.back_to_step` + góp ý ở `stage_runs.feedback`; `add_attempt` ⇒ `back_limit+1` rồi thực hiện quay lại; `use_current` ⇒ stage Đạt; `cancel` ⇒ huỷ. Người quyết/assignee như `redo_limit` | Q2; khớp mẫu `redo_limit` sẵn có, không option mới (test khoá `DECISION_OPTIONS`) |
| D9 | Nhiều decision mở cùng lúc (song song): `view.decision` = decision mở **cũ nhất**; `decide` nhận `stage_idx?`; `process_runs.decision` jsonb = bản mới nhất (chỉ để tương thích) | Hiện chỉ một `decision` jsonb/run |
| D10 | Lỗi luật def (6 `PROCESS_DEF_RULES`) dùng lại `PROCESS_DEF_INVALID` 422; lỗi hình dạng (11 stage, `step`/`back_to_steps` ngoài 0…9, > 9 phần tử) = 400 `VALIDATION_ERROR` + `issues[].path` (`parseJson`). Chi tiết: + `details.paths` và thêm `details.rules` cùng chỉ số (không thêm mã HTTP top-level) | FE đang map lỗi inline theo `paths`; nhiều vi phạm một lần |
| D11 | Resume (R12) **chỉ ở Hub**, không đổi Runtime (người dùng chấp nhận cho cả quy trình cũ — G-2): khoá session Runtime = `(conversation_id, agent_id, provider_key)` và mọi stage chung một hội thoại nền ⇒ Hub điều khiển bằng `use_session` + xoá `cli_sessions` trước job "chạy mới" (§4.2) | Không có quyền sửa `apps/agent-runtime`; `conversations_process_run_uq` cấm hội thoại riêng mỗi stage |
| D12 | TECH-DEBT #135: code đã sửa ở P-b (`persistDraft` trả `null`); P-b2 chỉ thêm int test "team ở bước 0 (đơn và song song)" rồi đóng nợ | `output-attachment.ts:105–136` |

## 1. Contract — trường đầy đủ
### 1.1 `chat/processes.ts` (hằng; `hub-admin` re-export qua `export *`)
```ts
export const PROCESS_STEP_MAX = PROCESS_STAGES_MAX - 1;        // 9 (FE B1)
export const PROCESS_STEP_STAGES_MAX = 3;
export const PROCESS_BACK_ROUNDS_MAX = 3;                       // default back_limit
export const BACK_EVENTS_MAX = 20;
export const HANDOFF_SECTION = "Bàn giao";
export const HANDOFF_TOKENS_MAX = 200;
export const HANDOFF_CHARS_PER_TOKEN = 4;
export const ProcessStepSchema = z.number().int().min(0).max(PROCESS_STEP_MAX);
export type ProcessStep = z.infer<typeof ProcessStepSchema>;
// DECISION_REASONS: thêm "back_limit" CUỐI mảng (16). CHAT_PROCESS_ERRORS (file chat/processes-errors.ts): thêm BACK_TARGET_INVALID: 422 (13).
```
### 1.2 `hub-admin/processes.ts` + file mới `hub-admin/process-steps.ts` (thuần, FE dùng chung)
- `ProcessStageDefSchema`: + `step: ProcessStepSchema.optional()`; biến thể `after` review: `{kind:"review", group_id, back_to_steps: z.array(ProcessStepSchema).max(PROCESS_STEP_MAX).default([])}`.
- `PROCESS_DEF_RULES = ["KEY_DUP","REAL_ACTION","STEP_INCOMPLETE","STEP_ORDER","STEP_TOO_WIDE","BACK_TARGET_INVALID"] as const`; `ProcessDefPathsDetailsSchema` + `rules: z.array(z.enum(PROCESS_DEF_RULES)).max(PROCESS_DEF_PATHS_MAX).optional()`.
- `processDefStagePaths(stages)` giữ chữ ký = `processDefStageIssues(stages).map(i => i.path)` (superRefine + `validateProcessDef` dùng issues).

| Luật | Điều kiện (i = chỉ số stage, `st` = `resolveSteps`) | Path (mỗi vi phạm một mục) |
|---|---|---|
| KEY_DUP | key trùng stage trước | `stages.<i>.key` |
| STEP_INCOMPLETE | ∃ stage có `step` ∧ ∃ stage thiếu | mọi stage **thiếu** `.step` |
| STEP_ORDER | `step[0]≠0` hoặc `step[i]−step[i−1] ∉ {0,1}` | **chỉ** stage vi phạm đầu tiên `.step` |
| STEP_TOO_WIDE | stage thứ 4+ (theo thứ tự mảng) của cùng bước | từng stage thừa `.step` |
| REAL_ACTION | `real_action` ∧ (`st[i]=0` ∨ ∃ j: `st[j]=st[i]−1` ∧ `after.kind≠review`) | `stages.<i>.real_action` |
| BACK_TARGET_INVALID | phần tử `t` của `back_to_steps`: `t ≥ st[i]` ∨ trùng phần tử trước | `stages.<i>.after.back_to_steps.<j>` |

Thứ tự liệt kê: i tăng; trong một stage: key → step → real_action → back. Có `STEP_INCOMPLETE`/`STEP_ORDER` ⇒ **bỏ** REAL_ACTION/BACK (bước chưa xác định). Cắt ≤ 20.
Hàm thuần (qc test trước):
```ts
export function resolveSteps(stages: readonly { step?: number }[]): number[];          // thiếu ở mọi stage ⇒ [0..n-1]
export function stepGroups(stages: readonly { step?: number }[]): number[][];          // [bước] → idx tăng dần
export type ProcessDefIssue = { path: string; rule: ProcessDefRule };
export function processDefStageIssues(stages: readonly ProcessStageDef[]): ProcessDefIssue[];
export function clipHandoff(text: string): { text: string; truncated: boolean };        // > 200×4 ký tự ⇒ cắt 800 + "…"
export function handoffTokens(text: string): number;                                    // ceil(chars/4)
```
### 1.3 `chat/processes-api.ts`, `processes-entities.ts`, `room-process.ts`, `me-stream-process.ts`
| Schema | Trường mới | Kiểu (bắt buộc?) |
|---|---|---|
| `ReviewDecisionRequestSchema` | `back_to_step` | `ProcessStepSchema.optional()` |
| `DecideProcessRunRequestSchema` | `stage_idx` | `StageIdxSchema.optional()` |
| `ProcessRunSummarySchema` | `current_step`, `step_count` | `ProcessStepSchema`; int 1…10 (bắt buộc) |
| `StageViewSchema` | `step`, `round`, `back_to_steps` | `ProcessStep`; int ≥1; `ProcessStep[] ≤9` (bắt buộc) |
| `ProcessRunTaskViewSchema.stages[]` | `step`, `round` | bắt buộc |
| `ProcessRunFullViewSchema` | `back_rounds`, `back_limit`, `back_events` | int ≥0; int ≥0; `BackEventSchema[] ≤ BACK_EVENTS_MAX` (bắt buộc) |
| `RunDecisionSchema` | `back_to_step` | optional (chỉ `back_limit`) |
| `BackEventSchema` (mới) | `at` IsoDateTime · `task_id` uuid\|null · `from_stage_idx` StageIdx · `from_step`/`to_step` ProcessStep · `round` int ≥2 · `feedback` string 1…4000 · `by` UserRef | strict |
| `TaskDetailSchema` | `back_steps`, `back_rounds_left` | optional; chỉ review **mở** của stage có `back_to_steps` ≠ [] |
| `HistoryItemSchema` | `to_step` | optional (review `fail` có quay lại) |
| `OutputRefSchema` | `round`, `handoff_truncated` | optional (meta thread cũ); cờ thôi — không sửa content, không UI (P-b2) |
| part `task_result` | `to_step` | optional |
| `ProcessUpdatedEventDataSchema` | `step` | optional |

### 1.4 Trả lời đề xuất FE (plan-frontend §9)
| # | Trả lời |
|---|---|
| B1 | Nhận: `PROCESS_STEP_MAX`, `PROCESS_STEP_STAGES_MAX`, `PROCESS_BACK_ROUNDS_MAX` + `resolveSteps`/`stepGroups`/`processDefStageIssues` từ `@ai/contracts/hub-admin` |
| B2 | Nhận: `StageView.back_to_steps`, `step`, `round`; summary `current_step`; full view `back_rounds`/`back_limit`; task view `step`/`round` |
| B3 | Không thêm mảng mới: `StageView.outputs[]` (≤20, cũ→mới) đã có; thêm `OutputRef.round` để nhóm "Bản n / vòng n" |
| B4 | `back_events[]` (full view) + `HistoryItem.to_step`; không thêm `kind:"back"` |
| B5 | `back_limit` có; **không** option `extend` — dùng `add_attempt` (FE gắn nhãn "+1 vòng" khi `reason=back_limit`) |
| B6 | `details.paths[]` + `details.rules[]` cùng chỉ số (không `issues[]`), path như §1.2 |

## 2. Lớp bước — hàm thuần (`core/step.rules.ts`, `gates/back.rules.ts`)
```ts
// core/step.rules.ts [HUB-FR-106][HUB-BR-38]
export function stageIdxsOfStep(steps: readonly number[], step: number): number[];
export function stepCountOf(steps: readonly number[]): number;
export function firstIdxOfStep(steps: readonly number[], step: number): number;      // = current_stage_idx
export function priorStageIdxs(steps: readonly number[], idx: number): number[];     // step < step(idx), tăng dần (R05)
export function stageGateStatus(run: ProcessRunStatus, stage: StageRunStatus): ProcessRunStatus;
//   run kết thúc ⇒ run; pending|queued|running ⇒ "running"; waiting_*|needs_decision ⇒ như tên; done ⇒ "done"; cancelled|failed ⇒ "cancelled"
export function runStatusOf(stepStatuses: readonly StageRunStatus[]): ProcessRunStatus | "step_done";
export type Join = { kind: "wait" } | { kind: "next_step"; step: number; queue: number[] } | { kind: "finish" };
export function stepJoin(p: { steps: readonly number[]; step: number; statuses: ReadonlyMap<number, StageRunStatus> }): Join;
//   mọi stage của `step` = done ⇒ next_step (queue = stageIdxsOfStep(step+1)) | finish (bước cuối); còn lại ⇒ wait
export function pickDecisionStage(open: readonly { stageIdx: number; createdAt: string }[], want?: number): number | null;
export function realActionStepCheck(
  prev: readonly { after: "review" | "auto"; status: StageRunStatus; passedBy: string | null; passedAt: string | null }[],
): { ok: true; passedBy: string } | { ok: false };   // rỗng / có auto / chưa done / thiếu passedBy ⇒ false; passedBy = người Đạt MUỘN nhất

// gates/back.rules.ts [HUB-FR-118]
export function backDecisionCheck(b: { result: "pass" | "fail"; feedback?: string; back_to_step?: number },
  stage: { step: number; backToSteps: readonly number[] }): "ok" | "FEEDBACK_REQUIRED" | "BACK_TARGET_INVALID";
export function backAllowed(run: { backRounds: number; backLimit: number }): boolean;           // backRounds < backLimit
export function backRoundsLeft(run: { backRounds: number; backLimit: number }): number;         // max(0, limit − rounds)
export type BackReset = { idx: number; status: "queued" | "pending"; round: number; feedback: string | null };
export function backResetPlan(p: { steps: readonly number[]; target: number; feedback: string;
  stages: readonly { idx: number; status: StageRunStatus; round: number }[] }): BackReset[];       // D7
```

## 3. Luồng engine (mọi tx: khoá `process_runs` FOR UPDATE trước — §7)
### 3.1 Bắt đầu (`start-inputs.ts`)
`stage_runs` mọi stage `pending`, rồi stage của **bước 0** `queued` (≤3); `current_step=0`, `current_stage_idx=0`. Snapshot giữ nguyên `stages` (có/không `step`).
### 3.2 Kick (`launcher.ts` + tách `launcher-step.ts`)
`kick` bỏ guard `status==='running'` → `!isTerminal(status)`. `plan()`: chọn `min(stage_idx)` có `status='queued'` trong `stageIdxsOfStep(current_step)` và chưa `alreadyRunning` ⇒ `launchStage` như cũ; trả `launch` ⇒ sau COMMIT `d.runs.launch` rồi `kick` lặp (≤ `PROCESS_STEP_STAGES_MAX+1`). `gateResolve` (nguồn) giữ: chặn mọi stage tới khi ghim.
`priorFiles(idx)`: `stage_idx IN priorStageIdxs(steps, idx)` (thay `stage_idx < idx`). `realActionPre`: `realActionStepCheck(stages bước liền trước)`; audit actor = người Đạt muộn nhất.
### 3.3 Job xong (`stage-driver.runApplyTx`, `team-runner.effects/persistState`)
1. Khoá run; `head.status` kết thúc ⇒ bỏ. `idx` = `stage_runs.stage_idx` theo `x.stageRunId`; `current_run_id ≠ hubRunId` ⇒ bỏ (đua với quay lại/huỷ).
2. `transition(buildState(stageGateStatus(...)), ev)`; ghi stage như cũ.
3. Nếu `effects` có `queue_next_stage|finish_run` (stage xong): stage ⇒ `done` (+`current_output_id`), rồi `stepJoin` trên trạng thái **sau ghi**: `wait` ⇒ chỉ cập nhật `process_runs.status = runStatusOf(bước)`; `next_step` ⇒ `current_step+1`, `current_stage_idx=firstIdxOfStep`, stage bước mới `queued`, status `running`, kick; `finish` ⇒ `done`.
4. Không phải xong (review/ask/redo/decision) ⇒ `process_runs.status = runStatusOf(bước)` (vd A `waiting_review` + B `running` ⇒ `running`).
`stageTimeout`, `loadStageSourceCtx`, `team-exec` headOf: nhận `idx` tham số (bỏ `current_stage_idx`). `team-runner.ts` (400 dòng) và `team-exec.ts` (399) phải tách: `persistState` + join ⇒ `runs/step-persist.ts`. **`persist` nhận idx stage thật** (từ `stageRunId`), cập nhật hàng `stage_runs` theo `stageRunId`, ghi `process_runs.current_stage_idx = firstIdxOfStep(current_step)` (không ghi idx stage vừa xong). **Mọi chuyển bước** (`next_step`, quay lại, `finish`) đi qua `runs/step-persist.ts`.
### 3.4 Duyệt Đạt / Chưa đạt (`gates.service.#review`)
Guard theo stage (`waiting_review`). Đạt ⇒ `setStagePassed` + `closeOpenTasks({stageRunId})` (D6) + §3.3 bước 3. Chưa đạt **không** `back_to_step` ⇒ như cũ (redo/`redo_limit`), stage-level. Có `back_to_step` ⇒ §3.5.
### 3.5 Quay lại (`gates/back.effects.ts`, tx của review)
1. `backDecisionCheck` (trước khoá) → khoá run → `closeTask` (first-wins; false ⇒ 409 `REVIEW_TASK_CLOSED`) → stage `waiting_review`?
2. `backAllowed` = false ⇒ stage `needs_decision`, `back_to_step=X`, `feedback`, `toDecision(back_limit)`; thread `task_result` (`to_step`); xong.
3. Ngược lại: `cancelStageRuns(run)` (huỷ `hub.runs` + `job_cancel` NOTIFY sẵn có) · `team_runs` `running|waiting_answer` của stage bị reset ⇒ `cancelled` · `closeOpenTasks(run, 'superseded', except=task)` · `backResetPlan` ⇒ UPDATE `stage_runs` (theo `stage_idx` tăng dần) · `process_runs`: `current_step=X`, `current_stage_idx=firstIdxOfStep(X)`, `back_rounds+1`, `status='running'`, `decision=NULL` · INSERT `process_back_events` · thread `task_result{result:'fail', to_step:X}` · notifier `taskClosed` · kick sau COMMIT.
4. Output cũ giữ ở `process_outputs` (version tăng tiếp; `round` = round stage lúc ghi).
### 3.6 Quyết định (`gates.service.#decide`)
`stage = pickDecisionStage(openDecisions, b.stage_idx)`; null ⇒ 409 `PROCESS_RUN_STATE`. `transition` trên stage đó; đóng **task decision của stage đó**. `back_limit` + `add_attempt` ⇒ `back_limit+1` rồi §3.5 bước 3 với `stage_runs.back_to_step/feedback` (`decided_by` = người quyết, `task_id` = task decision). `use_current` ⇒ Đạt (§3.4). Sau cùng: còn decision mở khác ⇒ `decision` jsonb = cái cũ nhất, status theo `runStatusOf`.
### 3.7 Hỏi lại / trả lời / chuyển (`asks`)
Guard theo stage `waiting_answer`; status run = `runStatusOf`. Không đổi API.
### 3.8 Sweeps (`sweeps.ts`)
`interrupted`: duyệt **mọi** stage `running` của bước hiện tại có `hub.runs` chết (mỗi stage một decision). `source_unresolvable`: gắn vào `firstIdxOfStep(current_step)`. Hết hạn/huỷ: như cũ (cả run).
### 3.9 View (`view.service.ts` 400 dòng ⇒ tách `runs/view-steps.ts`)
`step/round/back_to_steps` từ snapshot + `stage_runs`; `current_step`, `step_count`; `back_events` (`ORDER BY created_at DESC LIMIT 20` rồi đảo); `history.to_step` join `process_back_events.task_id`; `decision` theo D9; `TaskDetail.back_steps/back_rounds_left` (`core/task-view.ts`); `OutputRef.handoff_truncated = handoffTokens(sectionMap(process_outputs.content).get(HANDOFF_SECTION.trim().toLowerCase())) > 200` (`sectionMap` **export** từ `runs/template.rules.ts`, `Map` khoá `trim().toLowerCase()`; không dùng cột `sections`).

## 4. Bàn giao + resume (R10–R12, T7)
### 4.1 Bàn giao
- `defs/def.rules.ts`: `ensureHandoff<S extends {executor:{kind:string}; output:{required_sections:string[]; template:string}}>(s: S): S` (thuần; so khớp `trim().toLowerCase()`; **bỏ qua `executor.kind='team'`** — G-5); gọi ở `defs.service` create/update/copy **sau** validate. Seed/migration không qua ⇒ mẫu platform không đổi.
- Prompt stage (`launcher-prompt.ts`): thêm khối sau "Đầu vào":
  `Bàn giao từ bước trước:` + mỗi stage `priorStageIdxs` có mục `Bàn giao` trong `sectionMap(process_outputs.content)`: `### <tên stage> (s<idx>-v<ver>-<file>)\n<clipHandoff(text).text>`. Stage trước không có mục ⇒ chỉ file đính kèm (như cũ). File vẫn đính kèm (`priorFiles` + `agentFilesBlock` liệt kê đường dẫn; không nhúng nội dung). Thêm dòng nhắc "Bàn giao ≤ 200 token" (≤ 200 token tổng) vào hướng dẫn output.
- Hàm thuần `handoffBlock(items: readonly {name: string; file: string; handoff: string | null}[]): string | null` (`runs/handoff.rules.ts`).
### 4.2 Resume (SHOULD)
```ts
// runs/session.rules.ts
export type SessionCtx = { executor: "agent" | "team"; rerun: boolean /* attempt>1 ∨ round>1 */;
  continuing: boolean /* §dưới */;
  sameAgentInStep: boolean; lastWriterIsSelf: boolean; sessionExists: boolean /* có hàng ∧ updated_at ≤ SESSION_RESUME_MAX_AGE_S */ };
export type SessionPlan = { useSession: boolean; resume: boolean; clearSession: boolean };
export function sessionPlan(c: SessionCtx): SessionPlan;
//  thứ tự: team ⇒ {true,false,false} (giữ cũ) · sameAgentInStep ⇒ {false,false,false}
//  continuing ∧ sessionExists ⇒ {true,true,false} (prompt cũ, KHÔNG delta) · continuing ∧ ¬sessionExists ⇒ {true,false,true} · rerun ∧ lastWriterIsSelf ∧ sessionExists ⇒ {true,true,false} (delta)
//  còn lại ⇒ {true,false,true}
export function deltaPrompt(feedback: string, sections: readonly string[] | null): string;  // "Góp ý cần sửa:\n…" (+ "Mục cần sửa: …")
```
- `continuing` = tồn tại `review_tasks` `kind='ask'`, `result='answer'` của stage_run này với `decided_at` > `started_at` của `hub.runs` mới nhất của stage_run đó. `continuing ∧ ¬resume` (hết hạn/không session, hoặc cùng agent cùng bước) ⇒ prompt cũ (không delta) + nối cuối `Câu hỏi trước:
<q>
Trả lời:
<answer>` (task ask đã đóng của attempt hiện tại, ≤3). `sameAgentInStep` = ∃ stage khác cùng `step` trong snapshot cùng `executor.agent_id` (tĩnh).
- `lastWriterIsSelf`: `select stage_run_id from hub.runs where process_run_id=$run and tenant_id=$t and stage_run_id = any($stageRunIds cùng agent_id trong snapshot) and team_run_id is null and status='succeeded' order by finished_at desc limit 1` = stage này. `sessionExists`: PK `cli_sessions(conversation_id, agent_id, provider_key)` với provider bước đầu profile agent + `tenant_id`, và `updated_at ≥ now() − SESSION_RESUME_MAX_AGE_S` (hằng `runs/session.rules.ts` = **86400**, G-7; cũ hơn ⇒ false + `clearSession`). Tra cứu lỗi ⇒ `sessionExists=false` (⇒ `resume=false`). `continuing` ⇒ prompt cũ (không `deltaPrompt`).
- `clearSession` ⇒ `DELETE FROM hub.cli_sessions WHERE conversation_id=$conv AND agent_id=$agent AND tenant_id=$t` trong tx launch (GRANT DELETE có từ 0005). `useSession=false` ⇒ plumb `useSession?: boolean` qua `ProcessRunInput` → `RunContext` → `AgentTask` → `PayloadInput` → `buildJobPayload` (`use_session: isAgent && (useSession ?? true)`; chat không đổi).
- `resume` ∧ ¬`continuing` ⇒ `SendMessageRequest.content = deltaPrompt(...)`; ngược lại prompt đầy đủ (§4.1). Quay lại (§3.5) ⇒ stage bước X là `rerun` (round>1).
- Hệ quả đổi hành vi P-a: stage **sau** dùng cùng agent không còn resume session stage trước (trước đây ngầm resume) — đúng ý R12 "chạy mới đủ input".

## 5. DDL `0024_pb2_steps.sql` (viết tay, idempotent)
```sql
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='hub' AND table_name='process_runs'
                 AND column_name='current_step') THEN
    ALTER TABLE hub.process_runs ADD COLUMN current_step smallint NOT NULL DEFAULT 0;
    UPDATE hub.process_runs SET current_step = current_stage_idx;          -- run cũ: bước = chỉ số stage
  END IF;
END $$;
ALTER TABLE hub.process_runs ADD COLUMN IF NOT EXISTS back_rounds smallint NOT NULL DEFAULT 0;
ALTER TABLE hub.process_runs ADD COLUMN IF NOT EXISTS back_limit smallint NOT NULL DEFAULT 3;
-- process_runs_step_ck CHECK (current_step BETWEEN 0 AND 9)
-- process_runs_back_ck CHECK (back_rounds >= 0 AND back_rounds <= back_limit AND back_limit <= 100)
ALTER TABLE hub.stage_runs ADD COLUMN IF NOT EXISTS round smallint NOT NULL DEFAULT 1;
ALTER TABLE hub.stage_runs ADD COLUMN IF NOT EXISTS back_to_step smallint;
-- stage_runs_round_ck CHECK (round >= 1 AND (back_to_step IS NULL OR back_to_step BETWEEN 0 AND 9))
ALTER TABLE hub.process_outputs ADD COLUMN IF NOT EXISTS round smallint NOT NULL DEFAULT 1;
-- review_tasks_reason_ck: dựng lại (mẫu 0021 dòng 124–132, LIKE '%back_limit%') thêm 'back_limit'
CREATE TABLE IF NOT EXISTS hub.process_back_events (
  id uuid NOT NULL DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, process_run_id uuid NOT NULL,
  task_id uuid, from_stage_idx smallint NOT NULL, from_step smallint NOT NULL, to_step smallint NOT NULL,
  round_after smallint NOT NULL, feedback text NOT NULL, decided_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT process_back_events_pkey PRIMARY KEY (id),
  CONSTRAINT process_back_events_ck CHECK (from_stage_idx BETWEEN 0 AND 9 AND to_step >= 0 AND to_step < from_step
    AND from_step <= 9 AND round_after >= 2 AND char_length(feedback) BETWEEN 1 AND 4000),
  CONSTRAINT process_back_events_run_fk FOREIGN KEY (process_run_id, tenant_id)
    REFERENCES hub.process_runs (id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT process_back_events_task_fk FOREIGN KEY (task_id) REFERENCES hub.review_tasks (id) ON DELETE SET NULL);
CREATE INDEX IF NOT EXISTS process_back_events_run_idx ON hub.process_back_events (process_run_id, created_at);
ALTER TABLE hub.process_back_events ENABLE ROW LEVEL SECURITY;
-- policy process_back_events_hub_rw FOR ALL TO hub_rw USING/WITH CHECK v_t (chép biểu thức 0019 dòng 665–666)
GRANT SELECT, INSERT ON hub.process_back_events TO hub_rw;
```
Các CHECK thêm bằng khối `IF NOT EXISTS (pg_constraint …)`. Drizzle `schema/hub-processes.ts`: cột mới + bảng `processBackEvents`; **không** sửa `schema/hub.ts`. `_journal.json` thêm `0024` (0023 đã commit `8b90e0fc`). Không seed.

## 6. Hiệu năng / index
| Truy vấn | Index | Ghi chú |
|---|---|---|
| Stage của bước hiện tại | `stage_runs_run_idx_uq (process_run_id, stage_idx)` | ≤ 10 hàng |
| `back_events` của run | `process_back_events_run_idx` | `LIMIT 20` |
| Decision mở cũ nhất | `review_tasks_run_idx (process_run_id, created_at)` | lọc `kind='decision' AND status='open'` |
| `lastWriterIsSelf` | `runs_process_run_idx` | ≤ 10 × 4 hàng/run |
| `cli_sessions` | PK | — |
Ngân sách theo `CONVENTIONS.md` §6; không siết thêm (memory "Perf later").

## 7. Khoá, giao dịch, đồng thời
Thứ tự khoá P-a §10 giữ; thêm: trong `stage_runs` luôn UPDATE theo `stage_idx` tăng dần; `process_back_events` ghi sau `review_tasks`, trước `process_notices`. Mọi tx ghi khoá `process_runs` FOR UPDATE **trước** ⇒ job xong song song, Đạt song song, quay lại ∥ quay lại được tuần tự hoá.
| Đua | Kết quả mong đợi (int test) |
|---|---|
| A, B (cùng bước) cùng ra output | tx sau thấy A `done` ⇒ đúng **một** `next_step`; bước sau mỗi stage đúng một `hub.runs` (idempotent `current_run_id`) |
| A Đạt ∥ B output | B không bị `superseded`; join đúng một lần |
| Quay lại ∥ quay lại (khác đích, R09) | cái đầu thắng; cái sau 409 `REVIEW_TASK_CLOSED` (task đã `superseded`) |
| Quay lại ∥ job stage cùng bước xong | job sau thấy `current_run_id` NULL ⇒ bỏ; `hub.runs` đã `cancelled` |
| Quay lại ∥ huỷ / hết hạn | một trong hai; không hồi sinh run kết thúc |
| `back_limit` ∥ decide `stage_idx` khác | mỗi decision đúng stage của nó |

## 8. Test khoá P-a/P-b qc cần cập nhật (T2)
| Test | Vì sao |
|---|---|
| `tests/acceptance/P-a/step0/rules/contracts-pa.test.ts` (dòng 162, 178–200) | `DECISION_REASONS` 15→16; `CHAT_PROCESS_ERRORS` 12→13 mã |
| `P-a/step0/migration.int.test.ts`, `rls.int.test.ts` | bảng/cột mới, policy `process_back_events` |
| int lưu def rồi so `required_sections`/`template` (P-a `pf*`, P-b `pfs*`, `_support/process-fixtures.ts`) | `ensureHandoff` thêm "Bàn giao" khi lưu (Q3) |
| Fixture output stage sau lần lưu P-b2 | output thiếu `## Bàn giao` ⇒ `template_invalid` (fixture `fake-cli` phải có mục) |
| `P-a/pf1/gates.int.test.ts` | Đạt nay chỉ đóng task của stage (D6) — tuần tự không đổi, kiểm lại kỳ vọng `superseded` |
| `P-a/pf2/resume.int.test.ts` | D11 đổi `use_session`/xoá `cli_sessions` cho stage chạy mới |
| Snapshot schema strict trong unit/e2e chat (mock `ProcessRunView`) | trường bắt buộc mới `current_step`, `step_count`, `step`, `round`, `back_to_steps`, `back_*` |
| E-P15b / E-PB08 / E-PB09 | đã có trong T2 (selector panel, Bàn giao xuất hiện sau Lưu) |
Test mới gợi ý: AC-PB2-01…11 + bảng §7 + #135 (team bước 0) + `sessionPlan`/`backResetPlan`/`processDefStageIssues` (rules).

## 9. Rủi ro
| Rủi ro | Xử lý |
|---|---|
| Runtime thật lỗi khi resume session hết hạn ⇒ `agent_failed` | chỉ resume khi `sessionExists` (≤ 86400 s); **UAT bắt buộc 1 ca Claude thật** (G-7); SHOULD — tắt bằng `resume=false` |
| Sửa guard `running` sót một chỗ ⇒ stage song song kẹt | T5a liệt kê đủ (D3) + int test song song cho từng luồng §3 |
| File chạm 400 dòng (`team-runner`, `team-exec`, `view.service`, `launcher` 345) | tách như §3.2/§3.3/§3.9 trong cùng task |
| `ensureHandoff` đổi def người dùng khi lưu | đã chấp nhận (Q3); qc cập nhật fixture (§8) |

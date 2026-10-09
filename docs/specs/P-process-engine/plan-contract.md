# Plan phụ lục · Contract P-a (backend-lead sở hữu)

Mọi object `z.strictObject`; `Uuid`, `IsoDateTime`, `CountSchema` từ `../common`; lỗi body = `ErrorResponseSchema` M0 (`{error:{code,message,details?}}`). Chat **chỉ thêm** (file mới + 1 trường optional ở `RoomMessage`). Tên hằng giữ đúng — QC import.

## 1. Hằng (`chat/processes.ts`, export lại ở `hub-admin/processes.ts`)
```ts
PROCESS_KEY_RE = /^[a-z0-9-]{2,32}$/; PROCESS_NAME_MAX = 80; PROCESS_DESC_MAX = 500; PROCESS_INPUT_MAX = 8_000;
PROCESS_STAGES_MAX = 10; PROCESS_RUN_GROUPS_MAX = 20; PROCESS_OUTPUT_MAX = 200_000; FEEDBACK_MAX = 4_000; ANSWER_MAX = 4_000;
FORWARD_NOTE_MAX = 500; FORWARD_CHAIN_MAX = 3; REDO_MAX = 3; ASKS_MAX = 3; PROCESS_RUNS_PER_TENANT = 5;
PROCESS_RUN_TTL_DAYS = 7; REMIND_AFTER_H = 24; TOO_MANY_PROCESS_RUNS_RETRY_AFTER_S = 30; PROCESS_SUGGESTIONS_MAX = 3;
STAGE_TIMEOUT_S = { min: 60, default: 600, max: 3600 }; HISTORY_MAX = 200; PROCESS_LIST_LIMIT = { default: 50, max: 200 };
TEAM_LIMITS_DEFAULT = { max_calls: 10, max_tokens: 200_000, max_active_s: 600, summary_tokens: 200, max_plan_steps: 5 };
PROCESS_RUN_STATUSES = ["running","waiting_review","waiting_answer","needs_decision","done","cancelled","failed","expired"];
PROCESS_RUN_ACTIVE = ["running","waiting_review","waiting_answer","needs_decision"];
STAGE_RUN_STATUSES = ["pending","queued","running","waiting_answer","waiting_review","needs_decision","done","cancelled","failed"];
TEAM_MODES = ["sequential","lead_plan","parallel_merge"];      // mặc định "sequential" (spike)
TEAM_RUN_STATUSES = ["running","waiting_answer","done","limit","failed","cancelled"];
TASK_KINDS = ["review","ask","decision"]; TASK_STATUSES = ["open","closed"];
TASK_RESULTS = ["pass","fail","answer","add_attempt","use_current","cancel","cancelled","expired","superseded"];
DECISION_REASONS = ["redo_limit","ask_limit","template_invalid","team_calls","team_tokens","team_time","team_no_change",
  "job_timeout","stage_tokens","run_tokens","agent_failed","permission_lost","user_inactive","interrupted"];
DECISION_OPTIONS = ["add_attempt","use_current","cancel"];
NOTICE_KINDS = ["review_requested","ask_requested","decision_requested","reminder","task_closed","run_finished"];
ORIGIN_KINDS = ["room","conversation","admin"]; PROCESS_RUN_ID_HEADER = "X-Process-Run-Id";
PROCESS_SYSTEM_SENDER = { key: "process", name: { vi: "Quy trình", en: "Processes" } } as const;
```

## 2. Thực thể dùng chung
| Schema | Trường |
|---|---|
| `UserRef` | `{id: Uuid, display_name: string 1..DISPLAY_NAME_MAX}` |
| `ExecutorRef` | `{kind: "agent"\|"team", key, name: {vi,en}}` |
| `ProcessRunSummary` | `id, process: {key, name, version: int≥1}, status: RUN_STATUS, current_stage_idx: 0..9, stage_count: 1..10, started_by: UserRef, origin: {kind: ORIGIN_KIND, room_id?: Uuid, conversation_id?: Uuid}, started_at, updated_at, finished_at: Iso\|null, decision_reason?: DECISION_REASON` |
| `OutputRef` | `{id, version: int≥1, attempt: int≥1, template_ok: bool, template_missing: string[]≤20, created_at}` |
| `StageView` | `idx, key, name, executor: ExecutorRef, after: "review"\|"auto", real_action: bool, status: STAGE_STATUS, attempt, attempt_limit, asks_count, ask_limit, outputs: OutputRef[]≤20, current_output_id: Uuid\|null, passed_by: UserRef\|null, passed_at: Iso\|null` |
| `HistoryItem` | `{at, kind: "review"\|"ask"\|"decision"\|"forward"\|"cancel"\|"expire", task_id: Uuid\|null, stage_idx, actor: UserRef\|null, result?: TASK_RESULT, feedback?: ≤FEEDBACK_MAX, question?, answer?, note?, to?: UserRef}` |
| `TaskDetail` | `id, kind: TASK_KIND, status: TASK_STATUS, stage_idx, stage_name, output?: OutputRef (review), question?: ≤2000, choices?: string[]≤6, excerpt?: ≤1000, reason?: DECISION_REASON, forwards: {from: UserRef, to: UserRef, note: string\|null, at}[]≤3, result?: TASK_RESULT, can_act: bool, created_at` |
| `ProcessRunView` | `discriminatedUnion("access")`: **full** = `ProcessRunSummary & {access:"full", input: ≤8000, stages: StageView[], history: HistoryItem[]≤200, decision: {reason, stage_idx, options: DECISION_OPTION[], can_decide: bool}\|null, my_tasks: TaskDetail[]≤20, can_cancel: bool}` · **task** = `{access:"task", id, process: {key,name}, status, stages: {idx, name, status}[] (rỗng khi run đã kết thúc — M4), my_tasks: TaskDetail[]≥1}` |
| `ProcessOutput` | `{id, stage_idx, version, attempt, content: string ≤ PROCESS_OUTPUT_MAX, fields: Record<string, string\|number>\|null, template_ok, template_missing, created_at}` |
| `TokenTotals` | `{input, output, cache_read, cache_write, total, calls}` (int ≥ 0; total = 4 khoản đầu) |
| `UsageCall` | `{step_id: Uuid, role: "agent"\|"plan"\|"member", member_key: string\|null, agent: {key, name}, model: string\|null, tokens: TokenTotals (calls=1), latency_ms: int\|null, at}` |
| `ProcessRunUsage` | `{process_run_id, detail: "full"\|"summary", totals: TokenTotals, stages: {stage_idx, name, totals, attempts, asks_count, team_runs: {id, attempt, mode, status, stop_reason: string\|null, active_ms, totals, calls: UsageCall[]≤10}[], calls: UsageCall[]≤50}[]}` — `summary` (người xem `task`): `team_runs=[]`, `calls=[]` |

## 3. Chat endpoint (Bearer JWT mọi role; cờ tắt ⇒ không mount ⇒ 404)
Thứ tự kiểm chung: JWT 401 → **quyền xem** (404 nếu không thấy) → zod 400 `VALIDATION_ERROR` → trạng thái 409 → ghi.
| Endpoint | Request | 2xx | Lỗi | PF |
|---|---|---|---|---|
| `GET /processes` | — | 200 `{items: {key, name, description, input_hint, stage_count}[]≤200}` (bật + user ∈ run group, rỗng = cả công ty; sort name) | — | PF1 |
| `POST /process-runs` | `{process_key: KEY, input: string 0..8000 (trim), origin: {kind:"room", room_id} \| {kind:"conversation", conversation_id} \| {kind:"none"}}` — nút "▶ Quy trình" | 201 `ProcessRunSummary` + header | 404 `PROCESS_NOT_FOUND{suggestions}` (không có/tắt/không được chạy — không phân biệt) · 404 `NOT_FOUND` (room không là thành viên / conversation không của mình) · 429 `TOO_MANY_PROCESS_RUNS` + `Retry-After` | PF1 |
| `POST /rooms/:id/messages` (sửa, chỉ thêm) | như X2b; nội dung `!key …` (không `answer_run_id`) | 201 `RoomMessage{process_run_id}` + `X-Process-Run-Id`; `!!…` ⇒ tin thường bỏ một `!` | thứ tự X2b §3 tới bước 3 (trùng `client_msg_id` ⇒ 200) → `PROCESS_NOT_FOUND` / 429 (ROLLBACK, không lưu tin) | PF1 (hook B0) |
| `POST /conversations/:id/messages` (sửa, chỉ thêm) | `!key …` | **202** `{process_run: ProcessRunSummary}` + `X-Process-Run-Id` | 404 / 429 như trên | PF1 (hook B0) |
| `GET /process-runs` | query `scope: "mine"(mặc định)\|"tenant"`, `room_id?`, `conversation_id?`, `status?: RUN_STATUS`, `limit 1..200 (50)`, `cursor?` (mờ: `started_at,id`) | 200 `{items: ProcessRunSummary[], next_cursor: string\|null}` | `scope=tenant` không phải admin ⇒ 403 `FORBIDDEN`; `room_id` không là thành viên ⇒ 404 | PF1 |
| `GET /process-runs/:id` | `tenant_id?` (platform_admin) | 200 `ProcessRunView` | 404 | PF1 |
| `GET /process-runs/:id/outputs/:output_id` | — | 200 `ProcessOutput` (task: chỉ `output_id` của task mình) | 404 | PF1 |
| `GET /process-runs/:id/usage` | — | 200 `ProcessRunUsage` | 404 | PF4 |
| `POST /process-runs/:id/cancel` | `{}` | 200 `ProcessRunSummary` | 404 · 403 `NOT_PROCESS_DECIDER` (xem được nhưng không phải người bắt đầu/admin) · 409 `PROCESS_RUN_STATE` | PF1 |
| `POST /process-runs/:id/decide` | `{option: DECISION_OPTION, note?: ≤500}` | 200 `ProcessRunView` | 404 · 403 `NOT_PROCESS_DECIDER` · 409 `PROCESS_RUN_STATE` (không ở needs_decision) · 409 `NO_OUTPUT` (use_current chưa có output) | PF1 |
| `GET /me/review-tasks` | `status: "open"(mặc định)\|"closed"`, `limit`, `cursor` | 200 `{items: {task: TaskDetail, process_run: {id, process:{key,name}, status, started_by: UserRef}}[], next_cursor}` | — | PF3 |
| `POST /review-tasks/:id/decision` | `{result: "pass"\|"fail", feedback?: 1..4000 (trim), sections?: string[]≤20}` | 200 `TaskDetail` | 404 (không là assignee) · 422 `FEEDBACK_REQUIRED` (fail thiếu/rỗng) · 409 `TASK_KIND_MISMATCH` · 409 `REVIEW_TASK_CLOSED` | PF1 |
| `POST /review-tasks/:id/answer` | `{answer: 1..4000, choice?: string}` | 200 `TaskDetail` | 404 · 409 `TASK_KIND_MISMATCH` · 409 `REVIEW_TASK_CLOSED` | PF2 |
| `POST /review-tasks/:id/forward` | `{to_user_id: Uuid, note?: 0..500}` | 200 `TaskDetail` | 404 · 409 `TASK_KIND_MISMATCH` (decision) · 409 `REVIEW_TASK_CLOSED` · 409 `FORWARD_LIMIT` · 403 `FORWARD_OUT_OF_GROUP` (review) · 422 `FORWARD_TARGET_INVALID` (ask: không active/khác tenant/chính mình/đã là assignee) | PF2 |
| `GET /me/process-inbox` | `limit`, `cursor` | 200 `{sender: PROCESS_SYSTEM_SENDER, items: ProcessNotice[], unread: Count, next_cursor}` | — | PF3 |
| `POST /me/process-inbox/read` | `{up_to_id: Uuid}` | 200 `{unread: Count}` | 404 | PF3 |
`ProcessNotice = {id, kind: NOTICE_KIND, process_run_id, task_id: Uuid\|null, process_name, stage_name: string\|null, result?: TASK_RESULT, created_at, read: bool}` (không chứa nội dung output/câu hỏi — xem qua task).

## 4. Mã lỗi
`chat/processes-errors.ts` — `CHAT_PROCESS_ERRORS = { PROCESS_NOT_FOUND: 404, TOO_MANY_PROCESS_RUNS: 429, FEEDBACK_REQUIRED: 422, FORWARD_TARGET_INVALID: 422, REVIEW_TASK_CLOSED: 409, TASK_KIND_MISMATCH: 409, PROCESS_RUN_STATE: 409, NO_OUTPUT: 409, FORWARD_LIMIT: 409, FORWARD_OUT_OF_GROUP: 403, NOT_PROCESS_DECIDER: 403 }` + `ProcessNotFoundDetailsSchema {suggestions: string[]≤3}`. Không thêm vào `CHAT_API_ERRORS`/`CHAT_ROUTING_ERRORS`/`CHAT_ROOM_*` (test khoá).
`hub-admin/processes.ts` — `HUB_ADMIN_PROCESS_ERRORS = { PROCESS_KEY_TAKEN: 409, PROCESS_DEF_INVALID: 422, PROCESS_DEF_INCOMPLETE: 422, PROCESS_REF_INVALID: 422, TEMPLATE_READ_ONLY: 403 }`; details: `{paths: string[]≤20}` (INVALID/INCOMPLETE) · `{path, ref: "agent"\|"team"\|"group"\|"user"}` (REF_INVALID). Dùng kèm `VERSION_CONFLICT` (409, `version-conflict.ts`), `FORBIDDEN`, `TENANT_REQUIRED`, `NOT_FOUND`.

## 5. Sự kiện `/me/stream` (`chat/me-stream-process.ts`)
`ME_STREAM_PROCESS_EVENTS` (4) + `MeStreamProcessEventSchema` (discriminatedUnion) + `parseMeStreamProcessEvent(event, data) → … | null`:
| Sự kiện | `data` | Người nhận (phát sau COMMIT) |
|---|---|---|
| `process.updated` | `{process_run_id, status: RUN_STATUS, stage_idx: 0..9}` | người bắt đầu + thành viên đang hoạt động của phòng nguồn + assignee (user + thành viên group) các task open |
| `review_task.created` | `{task_id, kind: TASK_KIND, process_run_id}` | assignee của task (kể cả người mới được chuyển) |
| `review_task.closed` | `{task_id, result: TASK_RESULT}` | mọi assignee của task |
| `process.notice` | `{notice: ProcessNotice, unread: Count}` | chủ notice |

## 6. hub-admin (`hub-admin/processes.ts`; `tenant_admin` tenant mình, `platform_admin` cần `?tenant_id` cho dữ liệu tenant; mẫu `tenant_id=null` chỉ platform_admin ghi)
`ProcessStageDef = {key: KEY, name: 1..80, executor: {kind:"agent", agent_id} | {kind:"team", team_id}, instruction: 0..4000, output: {filename: /^[a-z0-9._-]{1,76}\.md$/, template: 1..20000, required_sections: string 1..80 [1..20], fields: {key: /^[a-z][a-z0-9_]{0,31}$/, type: "number"|"string"|"date", required: bool}[]≤20}, after: {kind:"review", group_id: Uuid|null} | {kind:"auto"}, real_action: bool, answerer: {kind:"starter"} | {kind:"group", group_id} | {kind:"user", user_id}, timeout_s: 60..3600 (600), token_budget: int 1000..5e6 | null}` — key stage duy nhất trong quy trình.
`ProcessDefInput = {key, name, description, input_hint, run_group_ids: Uuid[]≤20, stages: ProcessStageDef[1..10], token_budget: int|null, enabled: bool}`. Luật ở `def.rules.ts`: `real_action` ⇒ stage trước có `after.kind="review"` (else `PROCESS_DEF_INVALID{paths}`); `enabled=true` ⇒ mọi `group_id` review ≠ null (else `PROCESS_DEF_INCOMPLETE`); agent ∉ agent đã bật cho tenant / team ∉ nhóm bật cho tenant / group,user ∉ tenant ⇒ `PROCESS_REF_INVALID`.
| Endpoint | Body/query | 2xx | Lỗi |
|---|---|---|---|
| `GET /process-defs` | `tenant_id?`, `include_templates: bool (true)`, `limit`, `cursor` | `{items: {id, key, name, enabled, is_template, stage_count, version, updated_at, active_runs: Count}[], next_cursor}` | 403 member |
| `GET /process-defs/:id` | `tenant_id?` | `ProcessDef = ProcessDefInput & {id, tenant_id: Uuid|null, is_template, source_template_id, version, created_at, updated_at}` | 404 |
| `POST /process-defs` | `ProcessDefInput` (`tenant_id?` query cho platform_admin; vắng + platform_admin ⇒ tạo **mẫu**) | 201 `ProcessDef` | 409 `PROCESS_KEY_TAKEN` · 422 |
| `POST /process-defs/:id/copy` | `{key?, name?}` (mẫu → tenant; group_id review = null, `enabled=false`) | 201 `ProcessDef` | 404 · 409 KEY_TAKEN |
| `PUT /process-defs/:id` | `ProcessDefInput & {version}` | 200 `ProcessDef` | 409 `VERSION_CONFLICT` · 403 `TEMPLATE_READ_ONLY` (tenant_admin sửa mẫu) · 422 |
| `DELETE /process-defs/:id` | `version` query | 204 (xoá mềm; run đang chạy giữ snapshot) | 409 VERSION_CONFLICT |
| `POST /process-defs/:id/run` | `{input: 0..8000}` | 201 `ProcessRunSummary` (`origin.kind="admin"`, người bắt đầu = admin) | 403 `FORBIDDEN` (platform_admin: không phải user tenant) · 404 `PROCESS_NOT_FOUND` (tắt/mẫu) · 429 |
| `GET /agent-teams` | `tenant_id?` | `{items: {id, key, name, description, mode, members: {agent: {id, key, name}, role, sections}[]}[]}` (nhóm bật cho tenant) | 403 member |
Danh sách agent cho editor: dùng lại `GET /agent-settings` (H3b/CR-054). Run + token ở Evolu Control: `GET /process-runs?scope=tenant`, `GET /process-runs/:id`, `/usage` (§3).

## 7. Luật thuần — chữ ký (QC viết test trước ở `tests/acceptance/P-a/<pf>/rules/`)
```ts
// core/bang.rules.ts (B0) — M2, HUB-BR-28
export type Bang = { kind: "none" } | { kind: "escaped"; content: string } | { kind: "invalid"; token: string }
  | { kind: "process"; key: string; input: string };
export function classifyBang(content: string): Bang;
// core/process-state.rules.ts (B0) — §3 plan
export type RunEvent = { kind: "stage_output"; templateOk: boolean } | { kind: "need_input" } | { kind: "limit"; reason: DecisionReason }
  | { kind: "review"; result: "pass" | "fail" } | { kind: "answer" } | { kind: "decide"; option: DecisionOption }
  | { kind: "cancel" } | { kind: "expire" } | { kind: "permission_lost" | "user_inactive" | "interrupted" };
export type RunState = { status: RunStatus; stageIdx: number; stageCount: number; stage: { status: StageStatus;
  attempt: number; attemptLimit: number; asksCount: number; askLimit: number; after: "review" | "auto"; hasOutput: boolean } ;
  decisionReason: DecisionReason | null };
export function transition(s: RunState, e: RunEvent): { ok: true; next: RunState; effects: Effect[] } | { ok: false; code: "PROCESS_RUN_STATE" | "NO_OUTPUT" };
export type Effect = "queue_stage" | "queue_next_stage" | "open_review" | "open_ask" | "open_decision" | "close_open_tasks" | "cancel_stage_run" | "finish_run";
export const isTerminal: (s: RunStatus) => boolean;
// core/run-access.rules.ts (B0) — §5 plan, HUB-BR-25
export type Viewer = { userId: string; tenantId: string; role: "platform_admin" | "tenant_admin" | "member" };
export type RunFacts = { tenantId: string; startedBy: string; originRoomActiveMember: boolean; taskAssignee: boolean };
export function runAccess(v: Viewer, r: RunFacts | null): "full" | "task" | null;          // null ⇒ 404
export function canCancel(v: Viewer, r: RunFacts): boolean;
export function canDecide(v: Viewer, r: RunFacts & { reason: DecisionReason; reviewGroupMember: boolean }): boolean; // M5
export function canRun(u: { active: boolean; groupIds: ReadonlySet<string> }, d: { enabled: boolean; deleted: boolean; runGroupIds: readonly string[] }): boolean; // M1
// core/limits.rules.ts (B0)
export function teamLimitHit(s: { calls: number; tokens: number; activeMs: number }, l: TeamLimits): "calls" | "tokens" | "time" | null;
export function budgetHit(used: number, budget: number | null): boolean;
export function totalTokens(u: { input: number; output: number; cacheRead: number | null; cacheWrite: number | null }): number;
// runs/template.rules.ts (PF1) — P-R03, M3
export function checkTemplate(t: { requiredSections: readonly string[]; fields: readonly FieldDef[] }, md: string):
  { ok: boolean; missing: string[]; fields: Record<string, string | number> | null; fieldErrors: string[] };  // mục = heading "## <tên>" (so không phân biệt hoa thường, trim), thân không rỗng; trường = khối ```fields {json}```
// runs/team.rules.ts (PF1) — D7, D8
export function parseLeadPlan(raw: string, members: readonly { key: string; sections: readonly string[] }[], maxSteps: number):
  { ok: true; steps: { member: string; sections: string[]; instruction: string }[] } | { ok: false; reason: "json" | "empty" | "too_many" | "unknown_member" };
export function assembleSections(current: ReadonlyMap<string, string>, memberMd: string, owned: readonly string[]):
  { next: Map<string, string>; changed: boolean; foreign: string[] };   // mục không sở hữu bị bỏ (foreign)
export function renderDoc(template: string, sections: ReadonlyMap<string, string>): string;
export function clipSummary(text: string, maxTokens: number): string; // ≈ 4 ký tự/token, cắt cứng
export function redoMembers(members: readonly { key: string; sections: readonly string[] }[], q: { sections?: readonly string[]; feedback: string }): string[];
export function mergeQuestions(qs: readonly { member: string; role: string; question: string }[]): { question: string; choices: string[] };
// runs/start + gates (PF1)
export function realActionAllowed(prev: { after: "review" | "auto"; status: StageStatus } | null): boolean; // HUB-FR-109
export function reviewDecisionCheck(b: { result: "pass" | "fail"; feedback?: string }): "ok" | "FEEDBACK_REQUIRED";
export function suggestProcesses(typed: string, keys: readonly string[]): string[]; // ≤ 3, như suggestAgents
// asks/ask.rules.ts (PF2) — HUB-FR-110, 111
export function forwardCheck(t: { kind: TaskKind; status: TaskStatus; forwards: number; groupId: string | null; assigneeIds: ReadonlySet<string> },
  to: { id: string; active: boolean; sameTenant: boolean; groupIds: ReadonlySet<string> }, by: string):
  "ok" | "TASK_KIND_MISMATCH" | "REVIEW_TASK_CLOSED" | "FORWARD_LIMIT" | "FORWARD_OUT_OF_GROUP" | "FORWARD_TARGET_INVALID";
export function askExcerpt(input: string, max?: number): string; // ≤ 1 000 ký tự đầu của input run (Câu hỏi C4)
// notify/notify.rules.ts (PF3)
export function noticeRecipients(t: { userIds: readonly string[]; groupMemberIds: readonly string[] }, exclude?: string): string[];
export function dueReminder(t: { status: TaskStatus; remindAt: Date; remindedAt: Date | null }, now: Date): boolean;
// usage/usage.rules.ts (PF4) — HUB-FR-117
export type UsageRow = { runId: string; stageRunId: string; stageIdx: number; teamRunId: string | null; stepId: string | null;
  role: "agent" | "plan" | "member"; memberKey: string | null; agentKey: string; model: string | null; input: number; output: number;
  cacheRead: number | null; cacheWrite: number | null; latencyMs: number | null; at: Date };
export function buildUsage(rows: readonly UsageRow[], stages: readonly StageMeta[], detail: "full" | "summary"): ProcessRunUsage;
```

## 8. Security review riêng (RV1, HUB-BR-25)
Ma trận: {người bắt đầu, thành viên phòng, rời phòng, assignee user, thành viên group, người được chuyển, user khác cùng tenant, tenant khác, tenant_admin, platform_admin} × {GET run, output đang kiểm, output stage khác, usage, decision, answer, forward, decide, cancel, `GET /rooms/R`, tin phòng R, `/conversations` nền, `/runs/:id` stage}. Kỳ vọng: §5; tenant khác luôn 404; audit `view` có hàng.

## 9. Lệnh xong `done:pa`
`tools/scripts/src/done-pa.ts` (mẫu `done-x2b.ts`): check · typecheck · bun test · `test:int` P-a (pf1–pf4) · `bunx playwright test P-a` · `test:lock:verify` · `trace --check`. qc định danh sách test; backend-lead thêm int `lock-order` + migration 0019 idempotent (chạy 2 lần).

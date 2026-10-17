# Test plan · P-d-durable (qc, chế độ WRITE/PLAN — T3 + T3a + phần P-d2 của T15; chưa viết test, chưa LOCK)

Nguồn: [spec](spec.md) §2–§8 · [spec-ac](spec-ac.md) · [spec-tz-tools](spec-tz-tools.md) · [spec-ca](spec-ca.md) · [plan](plan.md) §0, §3–§7, §10 · [plan-domain](plan-domain.md) §1–§7 · [plan-db](plan-db.md) §1–§6 · [plan-contract](plan-contract.md) §1–§8 · [plan-d2](plan-d2.md) §3–§8 · BA-H §11 AC-H39…H47 · BA-A §11 AC-A14/A15 · CHAT-AC-59 · ADM-FR-71…73. Phụ lục: [`test-plan-rules.md`](test-plan-rules.md) (luật hẹn giờ/def/nhắc) · [`test-plan-int.md`](test-plan-int.md) (ca int P-d1 + ma trận cách ly + DB/RLS + UoW + tải) · [`test-plan-d2.md`](test-plan-d2.md) (T15: luật + int + contract P-d2) · [`test-plan-e2e.md`](test-plan-e2e.md) (e2e admin + chat) · [`test-plan-addendum.md`](test-plan-addendum.md). `P/` = `apps/hub-api/src/modules/processes/`.

**Quy ước mã ca:** `PD-U` luật lớp 1 · `PD-C` contract · `PD-A` kiến trúc · `PD-I` int P-d1 · `PD-P` tải · `PD-E` e2e · `PD2-*` P-d2 · `K` test khoá phải sửa. Tên test `"<AC/FR> · <mã ca> · mô tả"` (vd `"AC-H39 · PD-I01 · UPSTREAM_ERROR ×3 rồi ok ⇒ chạy lại 30 s/2'/8', attempt 1"`). Không `skip`/`only`/`sleep` cố định; chờ theo điều kiện (`waitStatus`, `waitFor`).

## 1. Bố cục file + lệnh + môi trường
| Nhóm | File (dưới `tests/acceptance/P-d/`) | Loại | Cần |
|---|---|---|---|
| Hỗ trợ | `_support/modules.ts` (`tryLoad` nghiêm, `loadDomain`, `loadUsecase`, `loadAdapter`, `fn`) · `_support/pd.ts` (`startPd` = `startPf1` + đồng hồ lệch, def fixture, `timersOf`, `sweepN`, `remind`) · `_support/two-tenant.ts` (acme + beta đối xứng) | — | — |
| Luật lớp 1 (không DB) | `rules/{job-error,retry,run-state,step-status,active-cap,start-inputs,timer-key,timer,due-at,wait-def,escalate-def,ttl,remind,escalate,forward,decision}.test.ts` | unit/rules | không DB, không env |
| Contract | `rules/contracts-pd1.test.ts`, `rules/domain-contract.test.ts` | contract | không DB |
| Kiến trúc | `arch/layers.test.ts` | arch | `dependency-cruiser` (đã có) |
| Int P-d1 | `d1/{retry,team-retry,wait,cap,cancel-timers,remind,ttl,isolation,db,uow,race,editor-context}.int.test.ts` | int | Postgres 16 + Redis (fakeredis đủ) |
| Admin múi giờ (AC-A14) | `admin/{timezone.int,timezone-rules}.test.ts` | int + rules | harness admin-api M1 (`M1/_fixtures`) |
| Tải | `perf/{timers,remind}.perf.int.test.ts` | perf | `bun run test:perf` (không thuộc Lệnh xong) |
| P-d2 (T15) | `rules/d2/**`, `d2/**`, `admin/workflow-tools*.test.ts` | xem [test-plan-d2](test-plan-d2.md) | mock Dify (`tools/mocks`, mẫu H2a) |
| E2E | `e2e/P-d/{admin-stage,admin-tenant,chat-labels}.pd.ts` + `playwright.pd.config.ts` | e2e | stack e2e như P-c2 |

**Lệnh:** luật `bun test tests/acceptance/P-d/rules tests/acceptance/P-d/arch` · int `bun run test:int tests/acceptance/P-d` · tải `bun run test:perf tests/acceptance/P-d/perf` · e2e `bunx playwright test -c e2e/P-d/playwright.pd.config.ts` · khoá `bun run test:lock:verify` · hồi quy `done:pa`, `done:pb`, `done:pb2`, `done:pc`, `done:pc2` (+ `bun run test:int tests/acceptance/{M1,M2,M3,M4}` khi T6a/T18a) · **chạy lại toàn bộ (CR-092, Luật 4b)**: `scripts/dev-db.ps1 -Wait` rồi `bun run test:all`; ghi kết quả khi báo xong lát/mốc.

**Môi trường:** DB riêng qc `bun run db:test:create qc` (`ai_system_qc_test`, `.env.test-qc.local`); dev local `scripts/dev-db.ps1` (Postgres 16 portable :5432 + fakeredis :6379 có Streams). Hub in-process `processLoops:false`, test gọi handle `sweepOnce`/`remindOnce`; runtime giả `ScriptRuntime` (`rt.fail(job, code, msg, reason, status)`) — không cần `fake-cli` cho int. **Không ca P-d nào cần Redis thật**: hẹn giờ/thử lại/khoá dựa Postgres (`FOR UPDATE`, UNIQUE, `fired_at`); Redis chỉ là đường `kick`/SSE sẵn có (fakeredis hỗ trợ). Redis thật + tải 10.000 run (D0a, ADR-0017) là spike/staging của GĐ0, **không** thuộc test khoá P-d. Ca "khởi động lại" = dừng hub-api in-process rồi dựng hub mới cùng DB (`secondHub`), không tắt Redis.

**Đồng hồ giả:** seam `now` của `startPf1` (`AppDeps.now` → port `Clock`). Dùng **đồng hồ lệch** `skew` (`now = () => new Date(Date.now() + skew)`, `advance(ms)` cộng `skew`) — thời gian vẫn chạy nên ca cũ dùng SQL `now()` không vỡ (mẫu `spikes/engine/engine.spike.test.ts` dùng đồng hồ đứng). Mọi mốc fixture tự chèn (`remind_at`, `due_at`, `started_at`) lấy từ `now()` của đồng hồ giả, không từ SQL `now()`.

## 2. Persona + dữ liệu (dùng lại `P-a/_support/pa.ts`; tenant `acme`, khác tenant `beta`)
| Vai | User | Dùng cho |
|---|---|---|
| A người bắt đầu | `lan` | start, quyết `retry_exhausted`/`timer_invalid` |
| B Group G1 "Kế toán" (trong phòng) | `hoa` | duyệt, forward trong G1 |
| T Group G1 ngoài phòng | `cuc` | nhận nhắc, forward tới |
| H Group **G2 "Giám đốc"** (mới, `pd.ts` tạo), ngoài phòng | `q01` | chuyển cấp, xem phần task, forward sai Group |
| Adm / P | `tadmin` / `padmin` | quyết, editor, sửa `timezone` |
| D beta | `an`, `tadmin_beta` + Group beta `ke-toan` | cách ly, Group tenant khác |
Def fixture (`pd.ts`, chèn qua API `POST /process-defs` để đi đúng luật lưu/ép): `pd-retry` (2 stage agent `auto`), `pd-real` (= `hoa-don-t`: stage 1 gate G1, stage 2 `real_action` agent `hd-post` có workflow `ghi-so` `side_effect`), `pd-team` (`qc-team` sequential m1/m2/m3) + `pd-team-lp` (lead_plan) + `pd-team-pm` (parallel_merge), `pd-wait-field` (step0 agent output `fields:[{key:"ngay_het_han",type:"date",required:false}]` auto → step1 `wait_until {from:{kind:"field",stage_key:<s0>,field:"ngay_het_han"}, offset_days:-3, time:"09:00"}` → step2 agent), `pd-wait-input` (input `han` kiểu `date`), `pd-remind` (gate G1 `remind_every_h:4`, `escalate:{after_h:24, group_id:G2}`), `pd-ttl-null` (`ttl_days:null`), `pd-par-wait` (step1 song song: `wait_until` + agent).

## 3. Ma trận AC → test
| AC/FR | Loại | File | Ca |
|---|---|---|---|
| AC-H39 thử lại (agent, `interrupted`, team) | int + rules | `d1/retry.int`, `d1/team-retry.int`; `rules/{job-error,retry,run-state}` | PD-I01…I05, PD-I10…I15; PD-U01…U19 |
| AC-H40 lỗi nghiệp vụ, `side_effect`, mã lạ | int + rules | `d1/retry.int`; `rules/job-error` | PD-I06…I09; PD-U01…U06 |
| AC-H41 `wait_until`, múi giờ, trần, restart, 2 instance, `timer_invalid`, input `date`, `WAIT_INVALID` | int + rules + contract | `d1/{wait,cap,cancel-timers,race}.int`; `rules/{due-at,wait-def,start-inputs,timer*,step-status,active-cap,decision}`; `rules/contracts-pd1` | PD-I20…I39 (+ PD2-I37 "stage nguồn `skipped`" ở P-d2); PD-U27…U66; PD-C03…C06 |
| AC-H42 nhắc lặp, chuyển cấp, xem ngoài phòng, forward, lưu def | int + rules + e2e | `d1/remind.int`; `rules/{remind,escalate,escalate-def,forward}`; e2e `admin-stage` | PD-I40…I49; PD-U67…U71, U76…U89; PD-E02 |
| AC-H43 `ttl_days` | int + rules | `d1/ttl.int`; `rules/ttl` | PD-I50…I54; PD-U72…U75 |
| AC-H46 cách ly tenant vòng nền + RLS + FK kép | int (RLS) | `d1/{isolation,db,uow}.int` | PD-I60…I78 |
| AC-A14 múi giờ tenant | int + contract + e2e | `admin/timezone.int`, `admin/timezone-rules`; e2e `admin-tenant` | PD-I80…I87; PD-C07; PD-E05 |
| AC-H44, H45, H47, AC-A15 (P-d2) | rules + int + contract + e2e | [test-plan-d2](test-plan-d2.md) | PD2-* |
| HUB-FR-143 / BR-41 | = AC-H39, H40 | | |
| HUB-FR-144 / BR-42 / FR-105 | = AC-H41, H46 | | |
| HUB-FR-145 / BR-43 / FR-107 / BR-25 / BR-26 | = AC-H42 | | |
| HUB-FR-115 | = AC-H43 + PD-I02 (`retry_exhausted`), PD-I26 (`timer_invalid`) | | |
| ADM-FR-71 (mở rộng panel stage) | e2e | `e2e/P-d/admin-stage.pd.ts` | PD-E01…E03; PD2-E01…E02 |
| ADM-FR-72 | = AC-A14 | | |
| ADM-FR-73 | = AC-A15 | test-plan-d2 | PD2-I40…I47, PD2-E03 |
| CHAT-AC-59 (nhãn trạng thái mới trên StageStrip theo bước) | e2e | `e2e/P-d/chat-labels.pd.ts` | PD-E06…E08; PD2-E04 |
| Kiến trúc lớp (CA-R03…R06) | arch + contract | `arch/layers`, `rules/domain-contract` | PD-A01…A04, PD-C10…C13 |

## 4. Luật lớp 1 (P-d1) — nạp `loadDomain("<rel>")` = `P/domain/<rel>` (plan-domain §4)
`N` = `2026-10-19T01:00:00.000Z`. `S(c,ra,rr,a,r)` = `RetryState{retryCount:c, retryAttempt:ra, retryRound:rr, attempt:a, round:r}`.
| Ca | File · hàm | Dữ liệu | Kỳ vọng |
|---|---|---|---|
| PD-U01 | `runs/job-error.rules` `classifyJobError` | `it.each` đủ **bảng plan-domain §4.1**: code ∈ {TIMEOUT, UPSTREAM_ERROR, ALL_PROVIDERS_EXHAUSTED, CANCELLED, BUDGET_EXCEEDED, NOT_CONFIGURED, INTERNAL_ERROR, `"WEIRD_X"`, null} × reason ∈ {null, timeout, upstream, crash, orphaned, provider_busy, tenant_slots, quota, provider_unavailable, cancelled, invalid_payload, invalid_output, sandbox, credential, refused, attachment, container, `"zzz"`} (162 ô) | T ⇔ reason ∈ 6 lý do tạm **hoặc** (reason null ∧ code ∈ {TIMEOUT, UPSTREAM_ERROR}); còn lại `"business"` |
| PD-U02 | ″ | `("INTERNAL_ERROR","crash")`, `("ALL_PROVIDERS_EXHAUSTED","provider_busy")`, `("ALL_PROVIDERS_EXHAUSTED","quota")` | `transient`, `transient`, `business` |
| PD-U03 | `TRANSIENT_JOB_REASONS`, `TRANSIENT_JOB_CODES` | — | đúng 6 / 2 phần tử nêu ở plan-domain §4.1 |
| PD-U04 | `legacyFailReason` | `{code:"TIMEOUT",interrupted:false}`, `{code:"UPSTREAM_ERROR",…false}`, `{code:null,interrupted:true}`, `{code:"INTERNAL_ERROR",…false}` | `job_timeout`, `agent_failed`, `interrupted`, `agent_failed` |
| PD-U05 | `classifyJobError` thuần | gọi 2 lần cùng tham số; chuỗi rỗng `""` | cùng kết quả; `("", "")` ⇒ `business` |
| PD-U10 | `runs/retry.rules` `effectiveRetryCount` | `S(2,1,1,1,1)`, `S(2,1,1,2,1)`, `S(2,1,1,1,2)`, `S(0,null,null,1,1)` | 2, 0, 0, 0 |
| PD-U11 | `retryDueAt` | `(N,1)`, `(N,2)`, `(N,3)` | N+30 s, N+120 s, N+480 s; `N` không bị đổi |
| PD-U12 | `decideRetry` | `cls:"business"`, legacy `agent_failed` | `{kind:"decide",reason:"agent_failed"}` |
| PD-U13 | ″ | transient, `sideEffectSent:true`, legacy `job_timeout` | `{kind:"decide",reason:"job_timeout"}` |
| PD-U14 | ″ | transient, `S(0,…)`, `S(1,1,1,1,1)`, `S(2,1,1,1,1)` | `retry` count 1 due N+30 s; 2/N+120 s; 3/N+480 s |
| PD-U15 | ″ | transient, `S(3,1,1,1,1)` | `{kind:"decide",reason:"retry_exhausted"}` |
| PD-U16 | ″ (reset ngầm PD-R06) | transient, `S(3,1,1,2,1)` (attempt mới), `S(3,1,1,1,2)` (round mới) | `retry` count 1 |
| PD-U17 | ″ | transient, legacy `interrupted`, `S(3,1,1,1,1)` | `retry_exhausted` (không `interrupted`) |
| PD-U20 | `runs/run-state.rules` `transition` (builder `st()` như `P-a/step0/rules/process-state.test.ts`) | run+stage `needs_decision` lý do `retry_exhausted`, sự kiện `{kind:"decide",option:"add_attempt"}` | stage `queued`, `attempt` giữ, run `running`, effects ⊇ `["queue_stage","reset_retry"]` |
| PD-U21 | ″ | lý do `timer_invalid`, `add_attempt` | stage `queued`, attempt giữ, effects ⊇ `["queue_stage"]`, không `reset_retry` |
| PD-U22 | ″ | `timer_invalid`, `use_current`, stage **không** output | không `NO_OUTPUT`; effects có `write_wait_skip` + nhánh advance |
| PD-U23 | ″ | `retry_exhausted`, `use_current`, không output | lỗi `NO_OUTPUT` (luật cũ) |
| PD-U24 | ″ | run `waiting_timer` + `cancel` / `expire` | `cancelled` / `expired`; `isTerminal("waiting_timer")` = false |
| PD-U25 | ″ hồi quy | 10 lý do của R-S17 + `permission_lost/user_inactive/interrupted` | như R-S17/R-S18 (không đổi) |
| PD-U27 | `runs/step.rules` `stageGateStatus`, `runStatusOf` | `["waiting_timer"]`; `["waiting_timer","running"]`; `["waiting_timer","waiting_review"]`; `["needs_decision","waiting_timer"]` | `waiting_timer`; `running`; `waiting_review`; `needs_decision` |
| PD-U28 | `statusForRun` | `("waiting_timer","retry")`, `("waiting_timer","wait_until")`, `("running",null)` | `queued`, `waiting_timer`, `running` |
| PD-U29 | `stepJoin` | bước có mọi stage `done` + một `waiting_timer` | chưa `step_done` |
| PD-U31 | `runs/active-cap.rules` | `CAP_COUNTED`; `countsTowardCap` × 9 trạng thái; `isActive` × 9 | đúng 4 = `running, waiting_review, waiting_answer, needs_decision`; `waiting_timer` ⇒ false/true |
| PD-U33 | `runs/start-inputs.rules` `isCalendarDate` | `2026-02-28`, `2028-02-29`, `2026-02-30`, `2027-02-29`, `2026-13-01`, `2026-2-3`, `""` | t, t, f, f, f, f, f |
| PD-U34 | `startInputIssues` | def `[{key:"han",type:"date",required:true}]`, value `2026-02-30` / `2026-02-28` / vắng | `[{index:0,path:"value"}]` / `[]` / issue `required` theo hành vi cũ |
| PD-U35 | ″ hồi quy | 4 kiểu cũ (text/select/file/source_ref) như `runs/start-inputs.ts` hiện nay | không đổi |
| PD-U37 | `timers/timer-key.rules` `timerKey` | `{kind:"retry",stageRunId:"s1",round:2,attempt:1,n:3}` | `"retry:s1:2:1:3"`; `n:0` ⇒ ném |
| PD-U38 | `timers/timer.rules` `isDue` | dueAt = N; now N−1 ms / N / N+1; `firedAt`≠null; `cancelledAt`≠null | f, t, t, f, f |
| PD-U39 | `fireAction` | (retry, waiting_timer, false), (wait_until, waiting_timer, false), (retry, queued, false), (wait_until, waiting_timer, true) | requeue, finish_wait, drop, drop |
| PD-U40 | `stagesToCancelOnBack` | stage step 0,1,2,3; `toStep` 1 | id của step 1,2,3 |
Phần còn lại của luật P-d1: §4b.

## 4b. Luật lớp 1 — hẹn giờ, def, nhắc
PD-U43…U92 (`due-at` gồm ca DST plan §4.7, `wait-def`, `escalate-def`, `ttl`, `remind`, `escalate`, `forward`, `decision`): [`test-plan-rules.md`](test-plan-rules.md).

## 5. Contract, mapper, kiến trúc
| Ca | File | Kỳ vọng |
|---|---|---|
| PD-C01 | `rules/contracts-pd1` | `PROCESS_RUN_STATUSES` = 8 cũ + `waiting_timer` (cuối, 9); `PROCESS_RUN_ACTIVE` = 4 cũ + `waiting_timer`; `PROCESS_RUN_CAP_COUNTED` = 4 cũ; `STAGE_RUN_STATUSES` cuối `waiting_timer` (10); `DECISION_REASONS` slice(-2) = `[retry_exhausted, timer_invalid]` (22); `NOTICE_KINDS` cuối `escalated`; `EXECUTOR_KINDS` = `[agent,team,apply,wait_until]`; `PROCESS_DEF_RULES` slice(14) = `[WAIT_INVALID, ESCALATE_INVALID]`; `INPUT_TYPES` (`hub-admin/sources`) cuối `date`; `HistoryItemSchema.kind` nhận `escalate` |
| PD-C02 | ″ | hằng: `STAGE_RETRY_MAX=3`, `RETRY_BACKOFF_S=[30,120,480]`, `REMIND_EVERY_H={4,168}`, `REMIND_MAX=10`, `ESCALATE_AFTER_H={4,2160}`, `PROCESS_TTL_DAYS={1,365,7}`, `PROCESS_RUN_TTL_DAYS=7`, `WAIT_OFFSET_DAYS={-365,365}`, `WAIT_HORIZON_DAYS=730`, `WAIT_TIME_DEFAULT="09:00"`, `TIMER_KINDS=[wait_until,retry]`, `TIMER_SWEEP_BATCH=100` |
| PD-C03 | ″ | `ProcessStageDefSchema` nhận executor `wait_until` (from input / field); `time` vắng ⇒ `"09:00"`; `time:"24:00"`, `"9:00"` lỗi; `offset_days` 366 lỗi |
| PD-C04 | ″ | `after.review` vắng `remind_every_h`/`escalate` ⇒ `null`; `remind_every_h` 3/169 lỗi; `escalate.after_h` 3/2161 lỗi |
| PD-C05 | ″ | `ProcessDefInputSchema` `ttl_days` vắng/null/1/365 ok; 0/366/1.5 lỗi; `ProcessDefSchema` luôn có `ttl_days` |
| PD-C06 | ″ | `ProcessInputValueSchema` `{type:"date",key,value:"2026-02-28"}` ok; `value` 11 ký tự lỗi; `isIsoCalendarDate("2026-02-30")` false; `IsoCalendarDateSchema` từ chối |
| PD-C07 | `admin/timezone-rules` | `TENANT_TZ_DEFAULT="Asia/Ho_Chi_Minh"`; `TimezoneInputSchema`: `Europe/Berlin` ok, `Asia/Saigon`, `Mars/Base`, `""`, 65 ký tự lỗi; `TenantCreateRequestSchema` vắng ⇒ mặc định; `TenantSchema` có `timezone` |
| PD-C08 | ″ | `StageViewSchema` nhận `retry_count` 0…3, `next_retry_at`, `last_error_code`, `wait{due_at,timezone}` (optional; view cũ không trường vẫn parse); `TaskDetailSchema.escalated/remind_count`; `ProcessEditorContextSchema {timezone}` |
| PD-C10 | `rules/domain-contract` | `P/domain/limits.ts` mỗi hằng §2 `toEqual` hằng contract (CA-R03) |
| PD-C11 | ″ | `TRANSIENT_JOB_REASONS` ⊆ `JOB_FAIL_REASONS` contract; `TRANSIENT_JOB_CODES` ⊆ `CHAT_RUN_ERROR_CODES` |
| PD-C12 | — (backend-lead, `P/adapters/processes.mapper.test.ts`, T6b) | qc **rà** đủ bảng plan-domain §6: `AssertEqual<ProcessRunStatus,(typeof PROCESS_RUN_STATUSES)[number]>`, `StageRunStatus`, `DecisionReason`, `DecisionOption`, `ExecutorKind`, `TimerKind`, `InputShape.type`↔`INPUT_TYPES`, `WaitFrom`↔`executor.from` (đổi tên khoá), `DOMAIN_ERROR_MAP` đủ mã. Test cạnh code không thuộc lock qc; qc kiểm tồn tại + xanh ở VERIFY |
| PD-A01 | `arch/layers` | chạy `depcruise` (API `cruise` của `dependency-cruiser`, config `.dependency-cruiser.cjs`) trên `P/domain`, `P/application` ⇒ 0 vi phạm `ca-domain-builtin-only`, `ca-application-inward-only`, `ca-inner-no-cross-module` |
| PD-A02 | ″ | quét văn bản `P/domain/**/*.ts`, `P/application/**/*.ts` (không `.test.ts`): không `Date.now(`, `new Date()`, `crypto.`, `Math.random(`, `TextEncoder`, `fetch(`, `process.env`, `import type … from "@ai/`, `from "zod"`, `from "node:` |
| PD-A03 | ″ | mỗi file `P/domain/**` ≤ 150 dòng, use case ≤ 120, repo ≤ 200 (plan §2) |
| PD-A04 | ″ P-d2 | như A01 cho `apps/admin-api/src/modules/workflow-tools/{domain,application}` |
`check_layers.py` (Python): P-d chỉ thêm ca `#fake:` cho `fake-cli` (công cụ test) ⇒ không ca mới; VERIFY chạy `bun run check` (gồm `check_layers.py`) xác nhận xanh.

## 6. Test khoá phải SỬA (qc, sau Gate — không sửa ở bước này)
Nguyên tắc: giữ **ý định** ca cũ; ca "lỗi ⇒ quyết ngay" dùng lỗi **nghiệp vụ** tương đương (reason `refused`/`credential` hoặc `INTERNAL_ERROR`); hành vi thử lại phủ bằng ca P-d mới. Enum so khớp nguyên mảng ⇒ đổi sang so **tiền tố** (bền cho cả P-d2), ca P-d mới kiểm đuôi.
| # | File:dòng | Lý do | Sửa thành | Khi |
|---|---|---|---|---|
| K01 | `P-a/pf1/stage.int.test.ts:228-236` (P1-25) | `TIMEOUT` (reason null) = tạm ⇒ thử lại | giữ kiểm `timeout_s=60`; sau `fail TIMEOUT` ⇒ stage `waiting_timer`, `retry_count` 1, `last_error_code` `TIMEOUT`, 0 decision (cạn lượt ở PD-I04) | T7 |
| K02 | `stage.int.test.ts:242` (P1-26) | `UPSTREAM_ERROR` reason null = tạm | `rt.fail(j, "UPSTREAM_ERROR", "agent lỗi", "refused")` ⇒ giữ `agent_failed` ngay | T7 |
| K03 | `stage.int.test.ts:280-292` (P1-28a) | `interrupted` = tạm | sau `sweep` ⇒ stage `waiting_timer`, `retry_count` 1, `last_error_code` `INTERRUPTED`, run `running`, 0 decision | T7 |
| K04 | `stage.int.test.ts:294-302` (P1-28b) | `aborted` không do huỷ run = tạm | như K03 | T7 |
| K05 | `P-b2/par/parallel.int.test.ts:285-303` (PI-14) | 2 stage `interrupted` ⇒ nay thử lại | 2 hẹn `retry` (mỗi stage một), run `running`, 0 decision; "view.decision = cũ nhất" chuyển sang PD-I05 | T7 |
| K06 | `P-b/pfs4/team-fix.int.test.ts:192-201` (TM-06) | Q1: thành viên lỗi tạm thử lại mức thành viên | stage `waiting_timer`, team-run `running`, hub.runs m2 `failed/UPSTREAM_ERROR` + message/hint, m3 chưa chạy, 0 decision | T7 |
| K07 | `team-fix.int.test.ts:203-208` (TM-07) | `TIMEOUT` = tạm | như K06 với `TIMEOUT`; bỏ kỳ vọng `job_timeout` | T7 |
| K08 | `team-fix.int.test.ts:210-214` (TM-08) | `NOT_CONFIGURED`+`credential` = nghiệp vụ | **giữ**, chạy lại | — |
| K09 | `team-fix.int.test.ts:216-223` (TM-09) | m1 lỗi tạm | như K06 (m2, m3 chưa chạy) | T7 |
| K10 | `team-fix.int.test.ts:74` + dùng ở `:229, :243, :254, :263, :278` (TM-10…14) | `upstream` tạm ⇒ không còn `needs_decision` ngay | thêm helper `refused = (j) => c.rt.fail(j,"UPSTREAM_ERROR","agent lỗi","refused")`, 5 ca dùng `failOnly(P1.agM2, refused)` | T7 |
| K11 | `team-fix.int.test.ts:289-290` (TM-15) | stage đơn `UPSTREAM_ERROR` tạm | dùng `refused` ⇒ giữ `agent_failed` | T7 |
| K12 | `team-fix.int.test.ts:5` (comment đầu) | mô tả | thêm "lỗi tạm thử lại theo P-d (Q1)" | T7 |
| K13 | `P-a/step0/rules/contracts-pa.test.ts:153-162` | `PROCESS_RUN_STATUSES` + `waiting_timer` | `.slice(0, 8)` | T5 |
| K14 | `contracts-pa.test.ts:163-168` | `PROCESS_RUN_ACTIVE` + `waiting_timer` | `.slice(0, 4)`; (đủ 5 ở PD-C01) | T5 |
| K15 | `contracts-pa.test.ts:175-183` | `ROOM_PROCESS_KINDS` + `branch` (P-d2) | `.slice(0, 7)` | T17 |
| K16 | `P-c2/rules/contracts-pc2.test.ts:119` | `EXECUTOR_KINDS` + `wait_until`/`tool` | `[...chat.EXECUTOR_KINDS].slice(0, 3)` | T5 |
| K17 | `contracts-pc2.test.ts:122-137` | `PROCESS_DEF_RULES` + 2 (+3 P-d2) | `.slice(0, 14)` | T5 |
| K18 | `contracts-pc2.test.ts:245-250` | `DECISION_REASONS.slice(-4)` đổi đuôi | `.slice(16, 20)` | T5 |
| K19 | `P-a/step0/rules/process-state.test.ts:52, 257` | T7s dời `core/process-state.rules.ts` | `loadDomain("runs/run-state.rules.ts")` | T7q |
| K20 | `P-a/step0/rules/task.test.ts:43` (+ 47, 54, 63, 87) | T8s dời `decisionAssignees`, T9s dời `canAct`; `askExcerpt` ở lại | loader theo tên: `decisionAssignees` ⇒ `domain/tasks/decision.rules.ts` (T8q); `canAct` ⇒ `domain/tasks/task-access.rules.ts` (T9q); `askExcerpt` ⇒ `core/task.rules.ts` | T8q, T9q |
| K21 | `P-c/rules/autofix-rules.test.ts:21` | `decisionOptionsFor` dời | `loadDomain("tasks/decision.rules.ts")` | T8q |
| K22 | `P-c2/rules/_rules2.ts:25` (dùng ở `apply-rules.test.ts:259`) | ″ | ″ | T8q |
| K23 | `P-b2/_support/_modules.ts:10` (dùng ở `rules/step-rules.test.ts:6`) | T8s dời `core/step.rules.ts` toàn file (plan-domain §7) | `loadDomain("runs/step.rules.ts")` (xem §8 câu hỏi 2) | T8q |
| K24 | `P-b2/_support/_modules.ts:12` (dùng ở `rules/back-rules.test.ts:6`) | T8s gộp `gates/back.rules.ts` | `loadDomain("gates/back.rules.ts")` | T8q |
| K25 | `P-a/pf3/rules/notify.test.ts:9` (R-N01, R-N02) | T9s dời `notify/notify.rules.ts` | `loadDomain("notify/remind.rules.ts")`; nội dung giữ | T9q |
| K26 | `P-a/pf2/rules/ask.test.ts:28` (R-AK*) | T9s dời `asks/ask.rules.ts` | `loadDomain("asks/forward.rules.ts")` | T9q |
| K27 | `P-a/pf1/rules/gate.test.ts:7-15` | dựa vào `tryLoad` trả `{}` cho 2 module **không tồn tại** (`runs/start.rules.ts`, `runs/runs.rules.ts`) | dùng `loadAnyOf([...])` (§7) | T3a |
| K28 | `M1/db-rls.int.test.ts:241-265` · `M2/db-rls.int.test.ts:276-297` · `M3/db-rls.int.test.ts:290-311` | bảng RLS admin 13 ⇒ 14 (`tenant_workflow_tools`, P-d2) | thêm tên vào danh sách, sửa "13" ⇒ "14" trong tên ca | T18a |
| K29 | `P-a/_support/modules.ts:1-30` | luật `tryLoad` | §7 | T3a |
K30 (T8s dời toàn file `run-access.rules.ts`), PD-C13 (parity), rà A6: [addendum](test-plan-addendum.md).
**Đã kiểm, KHÔNG sửa** (spec-ac §2 liệt kê nhưng không vỡ): `contracts-pb2.test.ts:116-119, 135, 149, 173` (so tiền tố / không phải enum) · `contracts-pc.test.ts:81, 259` (tiền tố) · `contracts-pa.test.ts:172-173` (tiền tố) · R-S18 `process-state.test.ts:239` (D-PD01: thử lại không qua `transition`) · `P-b/pfs3/rules/sources.rules.test.ts` (không so `INPUT_TYPES`; `M2/rules/contracts.test.ts:136` là `INPUT_TYPES` workflow, khác hằng) · `P-a/pf1/start.int.test.ts` (P1-07 giữ; ca `waiting_timer`/`ttl null` viết mới ở PD-I30, PD-I50) · `M1/tenants.int.test.ts`, `M1/rules/contracts.test.ts` (parse bằng `TenantSchema` contract) · `M4/rules/audit-snapshot.rules.test.ts:11` (dto không có `timezone` ⇒ vẫn đúng; ca mới PD-I83) · `M4/**` transfer (`timezone` optional) · `X2a/rules/__fixtures__/chat-exports-c1.json` (snapshot C1, không export quy trình) · `P-c/db.int`, `P-c2/db.int`, `P-b/pfs1/sources-db.int` (CHECK kiểm bằng `includes`) · `P-a/step0/{migration,rls}.int` · R-N02, P3-04, P3-06 (nhắc cũ giữ). Tất cả chạy lại ở VERIFY.

## 7. `tryLoad` báo rõ khi module vắng (T3a)
- `P-a/_support/modules.ts` (và helper mới `P-d/_support/modules.ts` dùng lại): `tryLoad(rel)` = `import(join(ROOT, rel))`; lỗi "Cannot find module" **đúng** đường dẫn đó ⇒ trả **Proxy vắng** mà mọi truy cập thuộc tính (trừ `then` và Symbol) ném `Error("module vắng: <rel>")` — ca đỏ từng `it` với thông điệp rõ, không vỡ cả file khi nạp ở đầu file (`P-b2/rules/step-rules.test.ts:6`); lỗi khác (cú pháp, import con hỏng) ⇒ **ném lại** kèm `cause` (không nuốt). `fn(mod, name)` giữ (vắng hàm ⇒ expect `{name:"function"}`).
- `loadAnyOf(rels)` (mới): nạp mọi đường dẫn, gộp export của module có thật; **không** module nào có ⇒ ném `"module vắng: <rels>"`. Dùng cho K27.
- `loadDomain(rel)` = `tryLoad("apps/hub-api/src/modules/processes/domain/" + rel)`; `loadUsecase`, `loadAdapter` tương tự cho `application/`, `adapters/`.
- Ca tự kiểm helper (`P-d/rules/_support.test.ts`): đường dẫn vắng ⇒ `expect(() => m.x).toThrow("module vắng: …")`; module có thật ⇒ export bình thường.
- **Danh sách helper nạp lặng lẽ** (ADR-0023 ghi "10"; grep thực tế 8 trả `{}`): `P-a/_support/modules.ts:12` (T3a) · `X2b/_modules.ts:11` (`loadRoomAgentRules`) · `X2b2/_modules.ts:9` · `FB1/_fb1.ts:63` · `H4b1/_h4b1.ts:191` · `H4b1/rules/_rules.ts:9` · `H4b2/rules/_rules.ts:8` · `K1/rules/_rules.ts:8`. Kế thừa qua `loadProcRules`: `P-b2/_support/_modules.ts`, `P-c/rules/_rules.ts`, `P-c2/rules/_rules2.ts`. Helper `load` **ném** (đã đúng luật, chỉ thông điệp gốc): `M1/_modules.ts:11`, `M2/_modules.ts:8`, `M3/_modules.ts:8`, `M4/_modules.ts:10`, `M4/_cd-modules.ts:9`, `X1/_modules.ts:10`, `X2a/_modules.ts:9`. T3a sửa `P-a` + tạo `P-d`; 7 helper còn lại sửa khi qc chạm lần đầu (CONVENTIONS §10).
- **Test khoá trỏ file sẽ dời** (đối chiếu plan-domain §7, plan-d2 §8): T7s ⇒ K19 · T8s ⇒ K20 (`decisionAssignees`), K21, K22, K23, K24 · T9s ⇒ K20 (`canAct`), K25, K26 · T10 (`expireRuns`) ⇒ không test nạp · T18s (`mcp.service`, `apply-settle`) ⇒ grep 0 test nạp đường dẫn (test `/mcp` đi qua HTTP) · T19s (`step-persist`) ⇒ 0 test nạp. `runs/start-inputs.ts`, `runs/{stage-driver,team-*,sweeps}.ts`, `runs.repo.countActive` ⇒ 0 test nạp đường dẫn.

## 8. Thứ tự viết test (trước code) + điều kiện
| Bước | Việc qc | Trước task | Lệnh "đỏ đúng lý do" |
|---|---|---|---|
| 1 | T3a: `tryLoad` + `loadAnyOf` + K27, K29; `P-d/_support/**` | T7s | `bun test tests/acceptance/P-a tests/acceptance/P-d/rules/_support.test.ts` — P-a xanh như cũ trên code hiện tại |
| 2 | Luật §4/§4b, contract §5 (PD-U, PD-C, PD-A) | T5, T6b | đỏ ở "module vắng" / expect hằng |
| 3 | Int retry/team (PD-I01…I15) + K01…K12 chuẩn bị (chưa áp) | T7 | đỏ ở expect trạng thái (stage còn `needs_decision`) |
| 4 | Int wait/cap/cancel/race (PD-I20…I39) | T8 | đỏ ở 400/422 hoặc expect |
| 5 | Int remind (PD-I40…I49), ttl (PD-I50…I54) | T9, T10 | ″ |
| 6 | Int cách ly/DB/UoW (PD-I60…I78), admin tz (PD-I80…I87), tải | T6, T6a, T6b | `needPdSchema` đỏ trước migration 0036/0011 |
| 7 | E2E P-d1 (PD-E01…E08) | T11 (cần nhãn plan-frontend) | đỏ ở `getByRole` |
| 8 | Nq cùng task dời: K19 (T7q), K20–K24 (T8q), K20/K25/K26 (T9q) + relock | T7s/T8s/T9s | `bun run test:lock:verify` |
| 9 | T15: [test-plan-d2](test-plan-d2.md) | T17–T19 | ″ |
Fixture SQL: theo "Bẫy đã gặp" CONVENTIONS §2 (`sql.json`, ép kiểu, không biến module chung). Schema guard `needPdSchema` = `to_regclass('hub.process_timers')` ∧ cột `stage_runs.retry_count` ∧ `admin.tenants.timezone`; vắng ⇒ bỏ chèn, đỏ ở `expect({migration0036:…})`.

## 9. Số test dự kiến
| Loại | P-d1 | P-d2 | Tổng |
|---|---|---|---|
| Luật lớp 1 (mã ca; mỗi mã 1–10 `it`/`it.each`) | 71 | 19 | 90 (≈ 205 `it` + 162 ô bảng lỗi) |
| Contract + mapper rà + kiến trúc | 16 | 6 + PD-A04 | 23 |
| Int | 78 | 42 | 120 |
| Tải (`perf`) | 3 | — | 3 |
| E2E | 8 | 5 | 13 |
| Test khoá sửa (mục K) | 27 (K01–K30 trừ K08 giữ, K15, K28) | 2 (K15, K28) | 29 |

## 10. Cần bổ sung / câu hỏi mở (mặc định qc dùng nếu không trả lời)
| # | Gửi | Nội dung | Mặc định |
|---|---|---|---|
| Q1 | docs-architect | `VALIDATION_ERROR` = 400 (AC-H41, AC-A14, PD-R13, TZ-R02) | test theo **400** |
| Q2 | backend-lead + docs-architect | Dời `core/step.rules.ts`: plan-domain §7 (T8s ⇒ `domain/runs/step.rules.ts`, toàn file) ↔ tasks T19s + spec-ca §5 (`domain/runs/step-join.rules.ts`); spec-ca §2 ghi `runs/run-status.rules.ts` ↔ plan-domain `statusForRun` ở `runs/step.rules.ts` | theo plan-domain (T8s, `runs/step.rules.ts`) |
| Q3 | backend-lead | **Đã trả lời** (plan-addendum A5) | PD-U93…U98 ([rules](test-plan-rules.md)) |
| Q4 | backend-lead | **Đã trả lời** (A7): `createHubUow(db,{clock,publish})`, `publish` bắt buộc | PD-I75…I77 dùng `publish` giả ghi mảng |
| Q5 | docs-architect | PD-R23: `after_h` sai, `escalate` ở stage `auto` qua API ⇒ 400 `VALIDATION_ERROR` (zod, `after.auto` strict) | `ESCALATE_INVALID` 422 chỉ khi trùng Group duyệt (PD-I47a); luật domain/contract báo thêm `afterH` sai và `escalate` ở `auto` (bản nháp FE, PD-U68) |
| Q6 | backend-lead | **Đã trả lời** (A7): `interrupted` thắng `TIMEOUT` | PD-U04b ([rules](test-plan-rules.md)) |
| Q8 | docs-architect | spec-ac §2 liệt kê sai/thiếu test khoá: thiếu P1-28b, TM-07, TM-09…TM-15, `gate.test.ts`, M1/M2/M3 db-rls; thừa `contracts-pb2`, `contracts-pc`, `sources.rules`, `start.int`, `M1 tenants` | cập nhật spec-ac §2 theo §6 trên |
| Q9 | backend-lead | **Đã trả lời** (A7): `round`/`attempt` bắt đầu 1; `n` đếm theo stage, không reset | PD-I01 `retry:<sr>:1:1:1`, `n` 2, 3; PD-I02 `n` 4 |
| Q10 | backend-lead | **Đã trả lời** (A7): `SweepResult.timers` | PD-I01, PD-I60 kiểm thêm `timers`; DB vẫn kiểm chính |

## 11. Kết quả "đỏ đúng lý do"
T3/T3a 2026-10-18: [test-plan-addendum §3](test-plan-addendum.md) (420 ca + 7 perf, 8 xanh, còn lại đỏ đúng lý do).

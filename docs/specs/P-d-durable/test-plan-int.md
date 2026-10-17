# Test plan · P-d1 · ca int (phụ lục của [test-plan.md](test-plan.md))

Hạ tầng: `P-d/_support/pd.ts` — `startPd(o)` = `startPf1({ now: clk.now, ...o })` (hub-api thật, launcher thật, `processLoops:false`), `clk = skewClock()` (`advance(ms)`), `sweepN(c, n)` (gọi `handles(c).sweepOnce()` n lần), `remind(c)` = `handles(c).remindOnce()`, `timersOf(sql, runId)`, `stageRow`, `decisionOf`, `waitStatus`, `nextStageJob`, `jobDone`, `rt.fail` (mẫu `P-a/pf1/_local.ts`). Người dùng/def: [test-plan §2](test-plan.md). `T0` = `clk.now()` lúc sự kiện đầu ca. Mọi ca đầu `needPdSchema(ready)`. Hàng `hub.process_timers` đọc bằng owner (`c.sql`).

## 1. Thử lại — `d1/retry.int.test.ts` (AC-H39, AC-H40 · HUB-FR-143 · HUB-BR-41)
| Ca | Bước | Kỳ vọng |
|---|---|---|
| PD-I01 | `pd-retry`: A start; job s0 `rt.fail(j,"UPSTREAM_ERROR","lỗi")` (reason null) ⇒ `sweep` tại T0+29 s ⇒ `advance` tới T0+30 s ⇒ `sweep` ⇒ job mới fail ⇒ T+120 s ⇒ fail ⇒ T+480 s ⇒ `jobDone` | sau lỗi 1: stage s0 `waiting_timer`, `retry_count` 1, `last_error_code` `UPSTREAM_ERROR`, `current_run_id` NULL, run `running`, 1 hàng hẹn `kind=retry` `due_at`=T0+30 s, khoá khớp `^retry:<sr>:\d+:\d+:1$`, `timezone` NULL; T0+29 s: 0 job mới; mỗi lần bắn: `fired_at` đặt, đúng 1 job mới, `attempt` = 1, `round` giữ; khoá `n` = 2, 3; view `stages[0].retry_count` 1→2→3, `next_retry_at` = `due_at` hẹn mở; sau `jobDone`: s0 `done`, s1 có job, 4 `hub.runs` cho s0 (3 failed + 1 finished) |
| PD-I02 | như I01 nhưng lỗi lần 4 | run + stage `needs_decision` lý do `retry_exhausted`; decision options `["add_attempt","cancel"]` (không output); A `decide add_attempt` ⇒ job mới **ngay** (không cần `sweep`, 0 hẹn mới), `retry_count` 0, `last_error_code` NULL, `attempt` giữ 1 |
| PD-I03 | `pd-retry`: hub.runs của job s0 `finished` 90 s trước (SQL như P1-28) ⇒ `sweep` | không `needs_decision`; stage `waiting_timer`, `last_error_code` `INTERRUPTED`, hẹn `retry` +30 s; bắn ⇒ job mới cùng attempt |
| PD-I04 | `TIMEOUT` reason `timeout` status `timed_out` × 4 (backoff đủ) | lần 1–3 hẹn retry; lần 4 `retry_exhausted` (không `job_timeout`) |
| PD-I05 | `pd-par-wait` biến thể 2 agent song song bước 1: cả hai hub.runs chết ⇒ `sweep` × 4 vòng (advance đủ) | 2 hẹn mỗi vòng (mỗi stage 1); cuối: 2 decision `retry_exhausted`, `view.decision.stage_idx` = decision cũ nhất (thay PI-14 cũ) |
| PD-I06 | `pd-real` tới stage 2 (`real_action`, Đạt gate); SQL chèn `hub.run_steps(type='tool', workflow_id=ghi-so, status='ok')` cho hub.run hiện tại; `rt.fail TIMEOUT` | `needs_decision` **`job_timeout`**; 0 hàng hẹn `retry`; `count(run_steps type in ('tool','workflow') of stage)` = 1 (tool gọi đúng 1 lần) |
| PD-I07 | như I06, `run_steps.status='skipped'` | thử lại (hẹn retry) |
| PD-I08 | như I06, workflow `side_effect=false` | thử lại |
| PD-I09 | lỗi nghiệp vụ, mỗi ca 1 run: `NOT_CONFIGURED`+`credential`; `UPSTREAM_ERROR`+`refused`; `ALL_PROVIDERS_EXHAUSTED`+`quota`; `INTERNAL_ERROR` reason null ("mã lạ" ⇒ nghiệp vụ, A2); output thiếu `## Tổng tiền` (`MD_MISSING`) ; thu hồi grant A trước khi bắn hẹn retry (mất quyền) | `needs_decision` ngay: `agent_failed` × 4 ca đầu, `template_invalid` (luật P-a giữ), `permission_lost`; `retry_count` 0; 0 hẹn `retry` |

## 2. Thử lại stage team — `d1/team-retry.int.test.ts` (AC-H39 · PD-R08 · Q1, plan §4.3)
| Ca | Bước | Kỳ vọng |
|---|---|---|
| PD-I10 | `pd-team` sequential: m1 ok, m2 `UPSTREAM_ERROR` | stage `waiting_timer`, `team_runs.status` `running`, `cursor` = 1, `segment_started_at` NULL, `calls` giữ; `active_ms` không tăng sau `advance(20 s)` (đọc 2 lần); m3 chưa có job |
| PD-I11 | tiếp I10: advance 30 s ⇒ `sweep` | job mới cho **m2** (không m1), `calls` không tăng; m2 ok, m3 ok ⇒ stage `done`/gate; `retry_count` stage = 1 |
| PD-I12 | m2 lỗi tạm × 4 | `retry_exhausted`; `team_runs.status` `failed`; m3 không job |
| PD-I13 | `pd-team-lp` lead_plan: lead lỗi tạm; biến thể: thành viên 2 lỗi sau khi có plan | gọi lại lead không đếm; biến thể: chạy tiếp từ `cursor` theo plan đã lưu (Q2 mặc định) |
| PD-I14 | `pd-team-pm` parallel_merge: m2 lỗi tạm | bắn ⇒ gọi lại **mọi** thành viên của lượt, lượt gọi lại không đếm `calls` (plan §10 Q2) |
| PD-I15 | m2 `NOT_CONFIGURED`+`credential` | `needs_decision` ngay (TM-08), `retry_count` 0 |

## 3. Hẹn giờ `wait_until` — `d1/wait.int.test.ts`, `d1/cap.int.test.ts`, `d1/cancel-timers.int.test.ts`, `d1/race.int.test.ts` (AC-H41 · HUB-FR-144 · HUB-BR-42 · TZ-R04)
| Ca | Bước | Kỳ vọng |
|---|---|---|
| PD-I20 | acme (mặc định HCM), clock 2026-11-01; `pd-wait-field`: s0 `jobDone` output fields `{ngay_het_han:"2026-11-20"}` | stage s1 `waiting_timer` + `started_at`; run `waiting_timer`; 0 `hub.runs`/job cho s1; hẹn `wait_until` `due_at` = `2026-11-17T02:00:00Z`, `timezone` `Asia/Ho_Chi_Minh`, khoá `^wait_until:<sr>:\d+:\d+:1$`; view `stages[1].wait = {due_at:"2026-11-17T02:00:00.000Z", timezone:"Asia/Ho_Chi_Minh"}`; executor ref `{kind:"wait_until",key:"wait_until",name:{vi:"Chờ tới ngày",en:"Wait until date"}}` |
| PD-I21 | owner `update admin.tenants set timezone='Europe/Berlin'` (acme), clock 2026-03-01; fields `2026-04-01` / run khác `2026-03-31` | `due_at` `2026-03-29T07:00Z` / `2026-03-28T08:00Z` |
| PD-I22 | sau I20 đổi `timezone` acme = `Europe/Berlin` | `due_at` + `timezone` hẹn giữ nguyên |
| PD-I23 | sau I20: dừng hub (`c.hub.stop`), dựng hub mới cùng DB (`secondHub`, cùng `clk`), advance tới `2026-11-17T02:00Z`, `sweep` trên hub mới | s1 `done`; `process_outputs` s1 = 1, nội dung = `"# <tên s1>\n\nĐã chờ tới 2026-11-17 09:00 (Asia/Ho_Chi_Minh).\n\n## Bàn giao\nĐã chờ tới 2026-11-17 09:00 (Asia/Ho_Chi_Minh).\n"`; s2 có đúng 1 job; `fired_at` đặt |
| PD-I24 | như I20 tới hạn; 2 hub cùng DB `Promise.all([sweep(h1), sweep(h2)])` × 3 lần | đúng 1 `fired_at`, 1 output s1, 1 job s2 (S4) |
| PD-I25 | trước hạn 1 phút `sweep` × 2 | không đổi gì |
| PD-I26 | `timer_invalid`, mỗi ca 1 run: (a) fields không có `ngay_het_han`; (b) def ttl 7, ngày +30 ngày (quá `expires_at`); (c) def `ttl_days:null`, ngày now+800 ngày | run + stage `needs_decision` `timer_invalid`; 0 hẹn; options `["add_attempt","use_current","cancel"]` |
| PD-I27 | (a) ⇒ A `decide use_current` | s1 `done`, output .md `"# <tên s1>\n\nBỏ chờ theo quyết định.\n\n## Bàn giao\nBỏ chờ theo quyết định.\n"`; s2 job; người quyết = như `agent_failed` (A, Adm ⇒ 200; B ⇒ 403/404 như P-a) |
| PD-I28 | (a) ⇒ Adm `decide add_attempt` sau khi sửa output s0 (SQL thêm field) | s1 tính lại ngày ⇒ 1 hẹn `wait_until` mới, khoá hậu tố `:2` (đếm dưới khoá run, attempt giữ), không 23505 (readiness #9) |
| PD-I29 | fields `ngay_het_han` = ngày hôm qua (dueAt ≤ now) | hàng hẹn vẫn ghi; `sweep` kế ⇒ s1 `done` (D-PD09) |
| PD-I30 | `cap.int`: SQL 4 run `running` + 1 `waiting_timer` acme ⇒ A start | 201 |
| PD-I31 | 5 `running` + 1 `waiting_timer` ⇒ A start | 429 + `Retry-After` như P1-07 |
| PD-I32 | 5 `running` (SQL) + run thật đang `waiting_timer` tới hạn ⇒ `sweep` | run tỉnh dậy, s2 có job (không bị trần) |
| PD-I33 | `pd-par-wait` bước 1: `wait_until` + agent song song | khi agent `running` ⇒ run `running`; agent `done` ⇒ run `waiting_timer`; stage backoff `retry` + stage khác `waiting_review` ⇒ run `running` (readiness #20) |
| PD-I34 | `pd-wait-input`: start với `inputs:[{key:"han",type:"date",value:"2026-02-30"}]` / `"2026-2-3"` / `"2026-02-28"` | 400 `VALIDATION_ERROR` `issues[0].path = ["inputs",0,"value"]`, 0 run / 400 (zod) / 201 |
| PD-I35 | `POST /process-defs` stage `wait_until` với `after.kind="review"`; `real_action:true`; nguồn field ở cùng bước; input `text` | 422 `PROCESS_DEF_INVALID`, `details.rules` ∋ `WAIT_INVALID`, `paths` ∋ `stages.1.executor` |
| PD-I36 | lưu def `wait_until` hợp lệ có `output.template` tuỳ ý, `answerer`, `token_budget` | `GET` def: `required_sections=["Bàn giao"]`, template `"# {name}\n\n## Bàn giao\n"`, `fields=[]`, `answerer={kind:"starter"}`, `token_budget=null` |
| PD-I37 | `cancel-timers.int`: run `waiting_timer` ⇒ A huỷ run; advance qua hạn, `sweep` | hẹn `cancelled_at` đặt (cùng tx huỷ), `fired_at` NULL, 0 output s1 |
| PD-I38 | hẹn `retry` mở ⇒ Adm huỷ run; `sweep` sau hạn | `cancelled_at`; 0 job mới; run `cancelled` không hồi sinh |
| PD-I39 | `race.int`: (a) `sweep` ∥ `POST cancel` cùng lúc trên hẹn tới hạn (×10 lặp); (b) quay lại bước ∥ bắn `wait_until`; (c) job lỗi muộn khi stage đã `waiting_timer` | (a) hoặc `cancelled_at` hoặc (`fired_at` + stage `queued` rồi `cancelled`) — không bao giờ cả hai, run cuối `cancelled`; (b) hẹn huỷ, 0 output; (c) không đổi stage, không hẹn thứ hai (plan §6) |

## 4. Nhắc lặp + chuyển cấp — `d1/remind.int.test.ts` (AC-H42 · HUB-FR-145 · HUB-BR-43/25/26)
| Ca | Bước | Kỳ vọng |
|---|---|---|
| PD-I40 | `pd-remind`: s0 xong ⇒ task review G1 tạo lúc T0 | `review_tasks`: `remind_every_h` 4, `remind_at` T0+4 h, `remind_count` 0, `escalate_at` T0+24 h, `escalate_group_id` G2, `escalated_at` NULL |
| PD-I41 | `remind` tại T0+3 h59; T0+4 h; T0+8 h; … tới T0+44 h | T0+3h59: 0 notice; mỗi mốc 4 h: đúng 1 notice `reminder`/assignee (B, T; sau T0+24 h thêm H); `remind_count` 1…10; sau 10 lần (T0+40 h) ⇒ T0+44 h không notice; task vẫn `open`, run `waiting_review` |
| PD-I42 | `remind` tại T0+24 h (và lặp lại lần 2) | `review_task_assignees` thêm 1 hàng `group_id` G2, `via='escalated'`, `tenant_id` acme; `escalated_at` = T0+24 h; notice `escalated` cho H (payload `process_name`, `stage_name`); DM hệ thống "Quy trình" cho H; audit `escalate` entity `review_task`, actor hệ thống, `details {from_group:G1,to_group:G2}`; lần 2: không thêm assignee/audit/notice |
| PD-I43 | sau I42: B `review pass` | 200, task `closed`; ca song song: H `review pass` (run khác) ⇒ 200 |
| PD-I44 | sau I42, không ai duyệt, advance T0+100 h, `remind`/`sweep` | task vẫn `open` (không tự Đạt/Chưa đạt) |
| PD-I45 | H (ngoài phòng) `GET /process-runs/:id` | `access:"task"`, không `inputs`/history; audit `view` (HUB-BR-25); `TaskDetail.escalated:true`, `remind_count` |
| PD-I46 | H forward tới B (G1) / B forward tới T (G1) / H forward tới thành viên G2 khác | `FORWARD_OUT_OF_GROUP` (HTTP như P-a P2-*) / 200 / 200 |
| PD-I47 | lưu def: (a) `escalate.group_id` = G1 (trùng Group duyệt); (b) `escalate` ở stage `after.kind="auto"`; (c) Group của beta; (d) uuid không tồn tại; (e) `after_h:3` và `2161` | (a)(b) 422 `PROCESS_DEF_INVALID` `rules ∋ ESCALATE_INVALID` path `stages.0.after.escalate`; (c)(d) 422 `PROCESS_REF_INVALID {path:"stages.0.after.escalate.group_id", ref:"group"}` (thông điệp như nhau); (e) 400 `VALIDATION_ERROR` (zod, không phải `ESCALATE_INVALID`; Q5). Ca (a) thay cho e2e PD-E02 |
| PD-I48 | xoá G2 (owner) trước T0+24 h ⇒ `remind` | không thêm assignee; `escalated_at` đặt; audit `escalate_skipped` |
| PD-I49 | (a) def không cấu hình ⇒ task review: `remind` tại T0+24 h ×2 ⇒ đúng 1 notice, `remind_count` 0, `reminded_at` đặt (R-N02/P3-04 không đổi); (b) task `ask`/`decision` giữ nhắc cũ; (c) sửa def `remind_every_h` 8 sau khi run bắt đầu | (a) như mô tả; (b) không chép `remind_every_h`/`escalate_at`; (c) task giữ 4 (snapshot) |

## 5. `ttl_days` — `d1/ttl.int.test.ts` (AC-H43 · HUB-FR-115 · PD-R24/R25)
| Ca | Bước | Kỳ vọng |
|---|---|---|
| PD-I50 | `pd-ttl-null` start ⇒ tới gate; advance 8 ngày ⇒ `sweep` | `expires_at` NULL; run `waiting_review`, không `expired` |
| PD-I51 | def tạo vắng `ttl_days` | `GET` def `ttl_days` 7; run `expires_at` = start+7 ngày; advance 7 ngày + 1 phút ⇒ `sweep` ⇒ `expired` (như P1-73) |
| PD-I52 | run đang chờ; `PUT` def `ttl_days:30` | run `expires_at` không đổi |
| PD-I53 | `PUT` def không gửi `ttl_days` / gửi `null`; `copy` def ttl 30 | giữ 30 / null / bản sao 30 |
| PD-I54 | `ttl_days` 0 / 366 / 1.5 | 400 `VALIDATION_ERROR` |

## 6. Cách ly tenant + DB + RLS — `d1/isolation.int.test.ts`, `d1/db.int.test.ts` (AC-H46 · S1 · K3/K7)
Fixture `two-tenant.ts`: acme và beta **đối xứng** — mỗi tenant 1 run hẹn `retry` tới hạn, 1 run `wait_until` tới hạn, 1 task review tới hạn nhắc lặp, 1 task tới hạn chuyển cấp (Group cùng tenant). Khuôn regression `scanDue` P-c2 (D1): mọi vòng nền chạy **một lượt chung** cho cả hai tenant.
| Ca | Bước | Kỳ vọng |
|---|---|---|
| PD-I60 | cả 8 hàng tới hạn cùng lúc ⇒ 1 `sweep` + 1 `remind` | mỗi hẹn: `fired_at` đặt, stage/run/output/job thuộc **đúng** tenant hàng (đếm theo `tenant_id`: acme 2 bắn, beta 2 bắn); notice/assignee/audit của mỗi task có `tenant_id` = task; 0 hàng `tenant_id` lệch giữa `process_timers`↔`process_runs`↔`stage_runs`↔`process_outputs`↔`hub.runs` (truy vấn chéo) |
| PD-I61 | chỉ beta tới hạn (acme +1 h) | acme: 0 thay đổi (`updated_at`, `fired_at`, notice) |
| PD-I62 | hẹn acme + beta cùng `due_at`, `stage_run_id` khác tenant; `sweep` song song 2 hub | mỗi hẹn 1 lần, đúng tenant |
| PD-I63 | owner chèn task acme có `escalate_group_id` = Group beta ⇒ `remind` | không assignee; audit `escalate_skipped` (S2) |
| PD-I64 | `hub_rw` scope user `an` (beta) `select * from hub.process_timers` | 0 hàng acme; `update … where tenant_id=acme` ⇒ 0 hàng; `insert` hàng `tenant_id` acme ⇒ 42501 (policy); `delete` ⇒ 42501 (không GRANT) |
| PD-I65 | owner chèn hẹn `tenant_id` beta với `stage_run_id`/`process_run_id` của acme | 23503 (FK kép) |
| PD-I66 | role `agent_runtime` `select hub.process_timers` | 42501 |
| PD-I67 | `GET /process-editor/context` bởi `tadmin` acme / `tadmin_beta` / `padmin ?tenant_id=beta` / padmin không tenant (mẫu) / `lan` (không admin) | `{timezone:"Asia/Ho_Chi_Minh"}` / tz beta / tz beta / `TENANT_TZ_DEFAULT` / 403 `FORBIDDEN` |
| PD-I68 | `db.int`: migrate lần 2 (`bun run db:migrate` hai lần, mẫu snapshot `H1/db.int.test.ts:80-97`) | không lỗi; snapshot cột/constraint/index/policy/RLS giống hệt |
| PD-I69 | hàng cũ sau migrate | `process_defs.ttl_days` 7; `stage_runs.retry_count` 0; `review_tasks.remind_count` 0; `admin.tenants.timezone` `Asia/Ho_Chi_Minh`; `process_runs.expires_at` nullable |
| PD-I70 | CHECK nới | `process_runs.status='waiting_timer'`, `stage_runs.status='waiting_timer'`, `review_tasks.reason ∈ {retry_exhausted,timer_invalid}`, `via='escalated'`, notice `escalated`, audit `escalate`/`escalate_skipped` ⇒ chèn được; `'waiting_x'`, `via='x'` ⇒ 23514; `retry_count` 4, `remind_count` 11, `remind_every_h` 3, `ttl_days` 0 ⇒ 23514 |
| PD-I71 | `process_timers` CHECK | `kind='cron'` ⇒ 23514; `wait_until` không `timezone` ⇒ 23514; `retry` có `timezone` ⇒ 23514; `fired_at`+`cancelled_at` cùng có ⇒ 23514; trùng `idempotency_key` ⇒ 23505 |
| PD-I72 | metadata | `relrowsecurity` true, `relforcerowsecurity` false; policy `process_timers_hub_rw`; GRANT `hub_rw` SELECT/INSERT/UPDATE, không DELETE; index `process_timers_due_idx` (partial), `_run_idx`, `_stage_idx`, `process_runs_expiring_idx`, `review_tasks_remind_due_idx`, `review_tasks_escalate_idx`; `process_runs_expires_idx` không còn |

## 7. UnitOfWork dưới RLS — `d1/uow.int.test.ts` (T6b/T6c · CA-R06 · K1/K2) — nạp `loadAdapter("hub-uow.ts")` `createHubUow`
| Ca | Bước | Kỳ vọng |
|---|---|---|
| PD-I73 | `uow.tenant({tenantId:beta,userId:an}, r => r.runs.lock(runAcme))`; `r.timers.lockById(timerAcme)` | null / không hàng (RLS + lọc tenant) |
| PD-I74 | `uow.system(beta, r => r.timers.cancelForRun(runAcme,"all", now))` | 0 hàng acme đổi |
| PD-I75 | `uow.system(acme, r => { r.outbox.emit({kind:"kick",runId}); throw })` | không sự kiện phát (rollback) — seam Q4 |
| PD-I76 | `uow.system(acme, …emit…)` thành công | sự kiện phát đúng 1 lần, **sau** COMMIT (listener thấy hàng đã ghi) |
| PD-I77 | `r.tenantId` trong `uow.system(acme)` | = acme; repo không nhận tham số tenant từ caller (kiểm chữ ký: `cancelForRun.length` không có tham số tenant) |
| PD-I78 | 2 tx song song cùng run (`uow.system`) bắn 1 hẹn | 1 lần (khoá run → timer) |

## 8. Admin múi giờ — `admin/timezone.int.test.ts` (AC-A14 · ADM-FR-72 · TZ-R01…R05) — harness `M1/_fixtures` (admin-api thật)
| Ca | Bước | Kỳ vọng |
|---|---|---|
| PD-I80 | `padmin` `PATCH /admin/tenants/:acme {version, timezone:"Europe/Berlin"}` | 200, `timezone` `Europe/Berlin`, `version`+1; audit `tenant`/`update` before `{timezone:"Asia/Ho_Chi_Minh"}` after `{timezone:"Europe/Berlin"}`; NOTIFY `config_changed {entity:"tenant", tenant_id}` (sentinel M3) |
| PD-I81 | `timezone` `Asia/Saigon` / `Mars/Base` / `""` | 400 `VALIDATION_ERROR` path `timezone` (Q1); DB không đổi |
| PD-I82 | `POST /admin/tenants` không `timezone` / có `Europe/Berlin` | `Asia/Ho_Chi_Minh` / `Europe/Berlin` |
| PD-I83 | `auditSnapshot("tenant", {...timezone})` (`lib/audit/audit.rules.ts`) | giữ `timezone` |
| PD-I84 | `tadmin` `PATCH /admin/tenants/:acme` | 403 |
| PD-I85 | `version` lệch | 409 `VERSION_CONFLICT` |
| PD-I86 | export yaml có `timezone`; import vắng `timezone` ⇒ giữ; import `Mars/Base` ⇒ lỗi `SCHEMA` (TZ-R05) | như mô tả |
| PD-I87 | sau PD-I80, Hub `wait_until` mới của acme (PD-I21 dùng chung bước) | hẹn sau thời điểm sửa theo Berlin; hẹn cũ giữ |

## 9. Tải — `perf/*.perf.int.test.ts` (`bun run test:perf`, báo số, không ngưỡng khoá)
| Ca | Dữ liệu | Kỳ vọng |
|---|---|---|
| PD-P01 | 1.000 hẹn `retry` tới hạn (500 acme + 500 beta, SQL fixture run/stage `waiting_timer`) ⇒ `sweep` lặp tới hết | mỗi lượt ≤ 100 (`TIMER_SWEEP_BATCH`), 10 lượt; 1.000 `fired_at`, 1.000 job, 0 trùng; báo ms/lượt p50/p95 |
| PD-P02 | như P01 với 2 hub quét song song | 1.000 bắn đúng 1 lần |
| PD-P03 | 1.000 task review `remind_every_h:4` tới hạn ⇒ `remind` lặp | ≤ 100/lượt; 1.000 `remind_count`=1; notice đúng số assignee; báo ms/lượt |
Ca chức năng nhỏ (thuộc Lệnh xong): PD-I24/I62 (song song) + **PD-I39d** trong `race.int`: 250 hẹn `retry` tới hạn, 2 hub quét song song ⇒ 3 lượt mỗi hub ⇒ 250 `fired_at`, 250 job, 0 trùng.

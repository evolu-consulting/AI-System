# Test plan P-b2-canvas · ca rules / contract / int (tách từ [test-plan.md](test-plan.md) §3)

Quy ước, fixture (§1), DB tag, bẫy: xem test-plan.md §0–§1. Gate/mặc định: [spec-decisions.md](spec-decisions.md). Số bước trong ca int theo `step` contract (0-based) trừ khi ghi "UI".


### 3.1 Luật thuần · contract (`rules/`, `bun test`) — đỏ ở `typeof fn !== "function"` / `safeParse` sai

**`rules/process-steps.test.ts`** — `@ai/contracts/hub-admin` (`resolveSteps`, `stepGroups`, `processDefStageIssues`, `clipHandoff`, `handoffTokens`, `processDefStagePaths`)
| Ca | Dữ liệu | Kỳ vọng |
|---|---|---|
| RD-01 | 4 stage không `step` | `resolveSteps` = `[0,1,2,3]`; `stepGroups` = `[[0],[1],[2],[3]]` |
| RD-02 | step `[0,1,1,2]` | `stepGroups` = `[[0],[1,2],[3]]` |
| RD-03 | step `[0,1,1,1,1]` (4 stage bước 1) | issue `{path:"stages.4.step", rule:"STEP_TOO_WIDE"}` (chỉ stage thứ 4+) |
| RD-04 | step `[0,0,0,0,0,1]` | 2 issue `STEP_TOO_WIDE` ở `stages.3.step`, `stages.4.step` |
| RD-05 | `step` có ở stage 0, 2, thiếu ở 1, 3 | `STEP_INCOMPLETE` ở `stages.1.step`, `stages.3.step` (mọi stage **thiếu**) |
| RD-06 | step `[1,1]` (không bắt đầu 0) | đúng 1 issue `STEP_ORDER` `stages.0.step` |
| RD-07 | step `[0,2,2]` (nhảy) | `STEP_ORDER` chỉ `stages.1.step` |
| RD-08 | step `[0,1,0]` (giảm) | `STEP_ORDER` chỉ `stages.2.step` |
| RD-09 | `STEP_ORDER` + stage có `real_action` + `back_to_steps` sai | **chỉ** issue STEP_* (bỏ REAL_ACTION/BACK khi bước chưa xác định) |
| RD-10 | key trùng ở stage 1 + 2 issue khác ở stage 1 | thứ tự: i tăng; trong stage: key → step → real_action → back |
| RD-11 | 25 vi phạm | cắt ≤ 20 |
| RD-12 | `processDefStagePaths(x)` | `= processDefStageIssues(x).map(i=>i.path)` (chữ ký cũ không vỡ) |
| RD-13 | `real_action` ở stage bước 0 | `REAL_ACTION` `stages.<i>.real_action` |
| RD-14 | bước 1 = {review, auto}, stage bước 2 `real_action` (AC-PB2-05) | `REAL_ACTION` |
| RD-15 | bước 1 = {review, review} | không issue |
| RD-16 | def cũ không `step`: stage i-1 review ⇒ ok; auto ⇒ lỗi (kết quả y luật cũ) | khớp `P-a` |
| RD-17 | stage bước 2 `back_to_steps:[2]` / `[3]` / `[0,0]` | `BACK_TARGET_INVALID` ở `stages.<i>.after.back_to_steps.<j>` (j của phần tử sai/trùng sau) |
| RD-18 | `back_to_steps:[0,1]` ở bước 2 | không issue |
| RH-01 | `clipHandoff("H"*800)` | `{truncated:false}`, text nguyên |
| RH-02 | `clipHandoff("H"*801)` | `{truncated:true}`, text = 800 ký tự + `"…"` |
| RH-03 | `handoffTokens("")`, `("abc")`, `("H"*801)` | `0`, `1`, `201` (ceil) |

**`rules/contracts-pb2.test.ts`** — `@ai/contracts/{chat,hub-admin}`
| Ca | Kỳ vọng |
|---|---|
| C-01 | hằng: `PROCESS_STEP_MAX=9`, `PROCESS_STEP_STAGES_MAX=3`, `PROCESS_BACK_ROUNDS_MAX=3`, `BACK_EVENTS_MAX=20`, `HANDOFF_SECTION="Bàn giao"`, `HANDOFF_TOKENS_MAX=200`, `HANDOFF_CHARS_PER_TOKEN=4`; re-export ở `hub-admin` |
| C-02 | `DECISION_REASONS` dài 16, phần tử **cuối** `"back_limit"`; `DECISION_OPTIONS` vẫn `["add_attempt","use_current","cancel"]` |
| C-03 | `CHAT_PROCESS_ERRORS` 13 mã, có `BACK_TARGET_INVALID: 422`; `HUB_ADMIN_PROCESS_ERRORS` không đổi (5) |
| C-04 | `ProcessStepSchema`: −1, 10, 1.5 ⇒ lỗi; 0, 9 ⇒ ok |
| C-05 | `ProcessStageDefSchema`: không `step` ⇒ ok; review không `back_to_steps` ⇒ parse ra `[]`; 10 phần tử ⇒ lỗi |
| C-06 | `ProcessDefInputSchema` (superRefine) 4 stage cùng bước ⇒ lỗi, issue path `stages.3.step` |
| C-07 | `ProcessDefPathsDetailsSchema` nhận `rules` cùng độ dài `paths`, `rules` ngoài enum ⇒ lỗi |
| C-08 | `ReviewDecisionRequestSchema` + `back_to_step` optional; `DecideProcessRunRequestSchema` + `stage_idx` optional |
| C-09 | `BackEventSchema` strict: `round:1` ⇒ lỗi; `feedback:""`/4001 ký tự ⇒ lỗi; khoá lạ ⇒ lỗi |
| C-10 | `ProcessRunSummarySchema` thiếu `current_step`/`step_count` ⇒ lỗi; `step_count` 0/11 ⇒ lỗi |
| C-11 | `StageViewSchema` bắt buộc `step`, `round≥1`, `back_to_steps`; `ProcessRunFullViewSchema` bắt buộc `back_rounds`, `back_limit`, `back_events ≤20`; `ProcessRunTaskViewSchema` **không** có khoá `back_events` (strict ⇒ thêm vào thì lỗi) |
| C-12 | optional mới không phá dữ liệu cũ: `OutputRef` không `round/handoff_truncated`, `HistoryItem` không `to_step`, part `task_result` không `to_step`, `ProcessUpdatedEventData` không `step` ⇒ ok |

**`rules/step-rules.test.ts`** — `processes/core/step.rules.ts`
| Ca | Kỳ vọng |
|---|---|
| RS-01 | steps `[0,1,1,2]`: `stageIdxsOfStep(…,1)=[1,2]`, `stepCountOf=3`, `firstIdxOfStep(…,1)=1`, `priorStageIdxs(…,3)=[0,1,2]`, `priorStageIdxs(…,2)=[0]` (R05 cùng bước không thấy nhau); steps `[0,1,2]` (cũ) ⇒ `priorStageIdxs(…,2)=[0,1]` |
| RS-02 | `stageGateStatus`: run `cancelled`/`done` ⇒ giữ run; stage `pending`/`queued`/`running` ⇒ `running`; `waiting_review`/`waiting_answer`/`needs_decision` ⇒ như tên; `done` ⇒ `done`; `cancelled`/`failed` ⇒ `cancelled` |
| RS-03 | `runStatusOf` ưu tiên (D2): `[needs_decision, running]` ⇒ `needs_decision`; `[waiting_review, running]` ⇒ `running`; `[waiting_review, waiting_answer]` ⇒ `waiting_answer`; `[done, waiting_review]` ⇒ `waiting_review`; `[queued, done]` ⇒ `running`; `[done, done]` ⇒ `"step_done"` |
| RS-04 | `stepJoin` steps `[0,1,1,2]`, step 1, statuses {1:done, 2:waiting_review} ⇒ `{kind:"wait"}` |
| RS-05 | … {1:done, 2:done} ⇒ `{kind:"next_step", step:2, queue:[3]}` |
| RS-06 | step 2 (cuối) {3:done} ⇒ `{kind:"finish"}` |
| RS-07 | steps `[0,1,1,1,2]`, step 0 done ⇒ `next_step` queue `[1,2,3]` (≤3) |
| RS-08 | thiếu hàng trong `statuses` cho 1 stage của bước ⇒ `wait` (không join sớm) |
| RS-09 | `pickDecisionStage([{2,"…:05"},{1,"…:09"}])` ⇒ 2 (cũ nhất); `want=1` ⇒ 1; `want=3` (không mở) ⇒ `null`; `[]` ⇒ `null` |
| RS-12 | `realActionStepCheck([])` ⇒ `{ok:false}`; có `auto` ⇒ false; review chưa `done` ⇒ false; thiếu `passedBy` ⇒ false |
| RS-13 | 2 review done, passedAt `10:00` (B) và `10:05` (T) ⇒ `{ok:true, passedBy:T}` (muộn nhất) |
| RS-14 | 1 review done (cũ, mỗi stage một bước) ⇒ ok, passedBy = người đó |

**`rules/back-rules.test.ts`** — `processes/gates/back.rules.ts`
| Ca | Kỳ vọng |
|---|---|
| RB-01 | `backDecisionCheck({result:"fail", back_to_step:1}, {step:3, backToSteps:[1]})` (thiếu feedback) ⇒ `FEEDBACK_REQUIRED`; feedback `"   "` ⇒ `FEEDBACK_REQUIRED` (thứ tự: góp ý trước) |
| RB-02 | `{result:"pass", back_to_step:1, feedback:"x"}` ⇒ `BACK_TARGET_INVALID` |
| RB-03 | `back_to_step:2` ∉ `[1]` ⇒ `BACK_TARGET_INVALID`; `backToSteps:[]` + `back_to_step:0` ⇒ `BACK_TARGET_INVALID` |
| RB-04 | hợp lệ ⇒ `"ok"`; `{result:"fail", feedback:"x"}` không `back_to_step` ⇒ `"ok"` (làm lại như cũ) |
| RB-05 | `backResetPlan({steps:[0,1,2,3], target:1, feedback:"Sai số", stages:[{0,done,1},{1,done,1},{2,done,1},{3,waiting_review,1}]})` ⇒ `[{1,queued,2,"Sai số"},{2,pending,2,null},{3,pending,2,null}]` (D7; sắp `idx` tăng) |
| RB-06 | bước > X còn `pending` (chưa chạy) ⇒ `round` giữ nguyên, `status:pending`, `feedback:null` |
| RB-07 | song song: steps `[0,1,1,2]`, target 1, stage 3 `pending` ⇒ idx 1, 2 `queued` round+1 cùng `feedback`; idx 3 `pending` round giữ |
| RB-08 | round đã 2 ⇒ 3 (cộng dồn) |
| RB-09 | `backAllowed({backRounds:2, backLimit:3})` = true; `{3,3}` = false; `{3,4}` = true |
| RB-10 | `backRoundsLeft({0,3})=3`, `{3,3}=0`, `{5,3}=0` |
| RB-11 | không có phần tử cho stage bước < X (vd idx 0) trong kết quả |

**`rules/handoff-session.test.ts`** — `runs/handoff.rules.ts`, `runs/session.rules.ts`, `defs/def.rules.ts` (mọi ca RR mặc định `continuing:false` trừ khi ghi khác)
| Ca | Kỳ vọng |
|---|---|
| RH-04 | `handoffBlock([])` ⇒ `null`; mọi `handoff:null` ⇒ `null` |
| RH-05 | `handoffBlock([{name:"Phân tích", file:"s0-v1-phan-tich.md", handoff:"HANDOFF-OK"}])` chứa `"Bàn giao từ bước trước:"`, `"### Phân tích (s0-v1-phan-tich.md)"`, `"HANDOFF-OK"` |
| RH-06 | handoff 900 ký tự ⇒ khối chứa 800 ký tự + `"…"`, không chứa ký tự 801 |
| RH-07 | `ensureHandoff`: thiếu ⇒ `required_sections` thêm `"Bàn giao"` **cuối**, `template` thêm `"\n\n## Bàn giao\n"` cuối; có sẵn `" bàn GIAO "` (trim/lower) ⇒ không đổi (không trùng); đã có ⇒ idempotent (gọi 2 lần = 1 lần) |
| RH-08 | `ensureHandoff` khi `required_sections` đã 20 mục hoặc `template` > 20 000 − len ⇒ không thêm (giữ hợp lệ schema) |
| RH-09 | **G-5** `ensureHandoff` với stage `executor.kind='team'` ⇒ không đổi `required_sections`/`template`; stage `agent` cùng def vẫn được thêm |
| RR-01 | `sessionPlan({executor:"team", …})` ⇒ `{useSession:true, resume:false, clearSession:false}` |
| RR-02 | `sameAgentInStep:true` ⇒ `{false,false,false}` |
| RR-03 | `rerun ∧ lastWriterIsSelf ∧ sessionExists` ⇒ `{true,true,false}` |
| RR-04 | `rerun:false` (lần đầu) ⇒ `{true,false,true}` (chạy mới, xoá session) |
| RR-05 | `rerun ∧ ¬lastWriterIsSelf` (đổi agent / agent khác viết sau) ⇒ `{true,false,true}`; `¬sessionExists` ⇒ `{true,false,true}` |
| RR-06 | `deltaPrompt("Thiếu MST", null)` bắt đầu `"Góp ý cần sửa:\n"` chứa `"Thiếu MST"`, **không** chứa `"Mục cần sửa"`; `("x", ["Tổng tiền"])` chứa `"Mục cần sửa: Tổng tiền"` |
| RR-07 | `deltaPrompt` không chứa nội dung "Đầu vào"/Bàn giao (chỉ delta) |
| RR-08 | `continuing:true` (vừa `waiting_answer` cùng attempt; `rerun:false`, `lastWriterIsSelf:false`) ⇒ `{true,true,false}` (resume, prompt cũ — không delta) |
| RR-10 | `continuing:true`, `sessionExists:false` ⇒ `{true,false,true}` (prompt cũ, không delta) |
| RR-11 | `continuing` = ask `answer` có `decided_at` > `started_at` run mới nhất: ask cũ hơn ⇒ false (kiểm SQL, int) |
| RR-09 | `continuing:true` + `sameAgentInStep:true` ⇒ `{false,false,false}`; `continuing:true` + `executor:"team"` ⇒ `{true,false,false}` (thứ tự ưu tiên: team → sameAgentInStep → continuing) |

### 3.2 Int · s0 (DB `pb2_s0`) — migration, RLS, lưu def

**`s0/migration.int.test.ts`** (HUB-FR-104, AC-PB2-11)
| Ca | Kỳ vọng |
|---|---|
| M-01 | `_journal` có `0023` rồi `0024`; chạy SQL 0024 lần 2 không lỗi (idempotent) |
| M-02 | cột: `process_runs.current_step` smallint NN default 0, `back_rounds` NN 0, `back_limit` NN 3; `stage_runs.round` NN 1, `back_to_step` NULL; `process_outputs.round` NN 1 |
| M-03 | idempotent backfill: run có `current_stage_idx=2`, đặt `current_step=1` bằng UPDATE, chạy lại 0024 ⇒ `current_step` vẫn 1 (UPDATE backfill chỉ khi vừa thêm cột) |
| M-04 | CHECK: `current_step=10` ⇒ lỗi; `back_rounds=4, back_limit=3` ⇒ lỗi; `back_limit=101` ⇒ lỗi; `round=0` ⇒ lỗi; `back_to_step=10` ⇒ lỗi; `review_tasks.reason='back_limit'` ⇒ ok, `'xyz'` ⇒ lỗi; `process_back_events` `to_step ≥ from_step` / `round_after=1` / feedback `''` ⇒ lỗi |
| M-05 | RLS: `hub_rw` scope `acme` INSERT event ⇒ ok; scope `beta` SELECT ⇒ **0 hàng**; INSERT với `tenant_id` khác scope ⇒ lỗi RLS |
| M-06 | GRANT append-only: `hub_rw` UPDATE / DELETE `process_back_events` ⇒ `permission denied` |
| M-07 | FK: xoá `process_runs` ⇒ event CASCADE; xoá `review_tasks` ⇒ `task_id` NULL |
| M-08 | index `process_back_events_run_idx (process_run_id, created_at)` tồn tại; policy tên `process_back_events_hub_rw` |

**`s0/defs.int.test.ts`** (AC-PB2-04/05/09, ADM-FR-71 phía server)
| Ca | Kỳ vọng |
|---|---|
| DF-01 | `POST /process-defs` 4 stage cùng `step:1` ⇒ 422 `PROCESS_DEF_INVALID`, stage 0 ở step 0 + 4 stage ở step 1; `details.paths` có `stages.4.step`, `details.rules` cùng chỉ số = `STEP_TOO_WIDE` |
| DF-02 | 11 stage, `step:10`, `back_to_steps` > 9 phần tử ⇒ **400 `VALIDATION_ERROR`** + `issues[].path` (không `STEP_TOO_WIDE`) |
| DF-03 | thiếu `step` ở 1 stage ⇒ `STEP_INCOMPLETE`; `step [0,2]` ⇒ `STEP_ORDER` (cả `PUT` và `POST …/copy` không áp vì copy từ mẫu hợp lệ — chỉ kiểm POST/PUT) |
| DF-04 | `back_to_steps:[2]` ở stage bước 2 ⇒ `BACK_TARGET_INVALID` path `stages.<i>.after.back_to_steps.0` |
| DF-05 | `real_action` bước 2, bước 1 {review, auto} ⇒ 422 `REAL_ACTION`; {review, review} ⇒ 201 |
| DF-06 | `ensureHandoff` (R10): POST def không có "Bàn giao" ⇒ response + GET có `required_sections` kết thúc `"Bàn giao"`, `template` kết thúc `"## Bàn giao\n"`; PUT lại cùng body ⇒ không nhân đôi; `POST /process-defs/:tpl/copy` ⇒ bản chép có "Bàn giao" |
| DF-07 | mẫu platform (seed) **không** đổi sau migrate (GET mẫu `sdlc` ⇒ không có "Bàn giao") |
| DF-08 | `tenant_admin` tenant `beta` PUT def `acme` ⇒ 404 (không lộ, hồi quy cách ly) |
| DF-09 | **G-5** POST def có 1 stage `team` + 1 stage `agent` (đều thiếu "Bàn giao") ⇒ response + GET: stage `agent` có "Bàn giao" cuối, stage `team` **không** |

### 3.3 Int · par (DB `pb2_par`) — bước song song (HUB-FR-106, HUB-BR-38a, AC-PB2-02/03)

**`par/parallel.int.test.ts`**
| Ca | Dữ liệu / bước | Kỳ vọng |
|---|---|---|
| PI-01 | start `pb2-auto3` | `stage_runs` 0 `queued`→job; 1–4 `pending`; `current_step=0`, `current_stage_idx=0` |
| PI-02 | X xong (`MD_HO`) | stage 1,2,3 **cùng** `queued` rồi mỗi stage đúng **1** `hub.runs` (3 job cùng lúc); `current_step=1`, `current_stage_idx=1`; `process.updated` có `step:1` |
| PI-03 | `pb2-par` qua bước 0; A=`Rà soát code` Đạt (B), `Test hồi quy` vẫn `waiting_review` | stage 3 vẫn `pending`, 0 job mới (`noStageJob`); run `waiting_review` |
| PI-04 | T Đạt `Test hồi quy` | stage 3 `queued` + đúng 1 job; `current_step=2` |
| PI-05 | `pb2-auto3` Y1, Y3 xong, Y2 `running` | run `running`, Z chưa chạy; Y2 xong ⇒ Z chạy; Z xong ⇒ run `done` |
| PI-06 | `pb2-par` bước 1: `Rà soát code` `waiting_review`, `Test hồi quy` `running` | `process_runs.status = running` (D2); task review `Rà soát code` mở |
| PI-07 | job hỏi lại ở stage 1 (`waiting_answer`), stage 2 `running` | run `running`; A trả lời ⇒ stage 1 chạy tiếp, stage 2 không ảnh hưởng |
| PI-08 | **AC-PB2-03** bước 1: `Rà soát code` Chưa đạt (góp ý "Thiếu test"), `Test hồi quy` Đạt | chỉ stage 1 `attempt=2` + job mới prompt chứa "Thiếu test"; stage 2 `done`, `attempt=1`, không job mới; stage 3 `pending` |
| PI-09 | **D6** B Đạt stage 1 khi stage 2 còn task review mở | task stage 2 vẫn `open` (không `superseded`); task stage 1 `status='closed', result='pass'` |
| PI-10 | stage 1 output M3 thiếu mục 4 lần ⇒ `needs_decision template_invalid` | run `needs_decision`; stage 2 vẫn chạy nốt tới `waiting_review`; bước 2 không khởi động; `view.decision.stage_idx = 1` |
| PI-11 | huỷ run khi bước 1 có 2 job | cả 2 `hub.runs` `cancelled`, mọi task mở `cancelled` (huỷ = cả run) |
| PI-11b | **HUB-FR-111** huỷ run khi stage 1 `done` (Đạt), stage 2 `running` | 200; run `cancelled`; `hub.runs` stage 2 `cancelled` (không 409 `PROCESS_RUN_STATE`) |
| PI-11c | **HUB-FR-111** huỷ run khi stage 1 `done` (Đạt), stage 2 `waiting_review` | 200; run `cancelled`; task review stage 2 `cancelled`, không còn task `open` |
| PI-12 | `pb2-real`: R0a Đạt bởi B (10:00), R0b Đạt bởi T (sau) | `Ghi sổ` chạy; audit actor = T (người Đạt muộn nhất); nếu đổi R0b thành auto (def khác) ⇒ không tạo được def (DF-05) |
| PI-13 | quota R15: `runsPerTenant=1`, run `pb2-auto3` đang ở bước 1 (3 job) | A start run 2 ⇒ 429 `TOO_MANY_PROCESS_RUNS` (đếm run, không đếm stage); 3 job bước 1 đều `user_id = A` |
| PI-14 | sweeps `interrupted`: bước 1 có 2 `hub.runs` bị đánh `failed` (Runtime chết) | `sweepOnce` ⇒ **2** decision `interrupted` (mỗi stage một task); `view.decision` = cái cũ nhất |
| PF-01 | **R05** `pb2-par`: job `Tổng hợp` (bước 2) | `priorFiles` = output mới nhất của stage 0, 1, 2; job `Test hồi quy` (bước 1) **không** có file của `Rà soát code` |
| PF-02 | `Tổng hợp` sau khi stage 1 có v1, v2 | chỉ v2 (bản mới nhất) |
| PF-03 | def cũ `hoa-don-t` stage 1 | `priorFiles` = stage 0 (y như P-a) |

**`par/race.int.test.ts`** (plan §7; mỗi ca lặp 10 vòng như P1-47)
| Ca | Kỳ vọng |
|---|---|
| RA-01 | Y1, Y2, Y3 `jobDone` đồng thời (`Promise.all`) | đúng **một** `next_step` (`current_step=2` một lần); Z đúng 1 `hub.runs` |
| RA-02 | B Đạt stage 1 ∥ job stage 2 trả output | task stage 2 không `superseded`; join đúng 1 lần |
| RA-03 | `back_limit` stage 3 ∥ decide `stage_idx=1` (redo_limit stage 1) | mỗi decision đóng đúng task của stage mình |

**`par/team0.int.test.ts`** (#135, R18)
| Ca | Kỳ vọng |
|---|---|
| PT-01 | `pb2-team0` start | stage team bước 0 chạy được (job member 1), không 500; `persistDraft` khi chưa job ⇒ không ném; tới `done` |
| PT-02 | `pb2-team0p` | team + agent cùng bước 0 cùng `queued`; join ⇒ `Kết` chạy |

### 3.4 Int · back (DB `pb2_back`) — quay lại (HUB-FR-118, HUB-BR-38d, AC-PB2-06/07/08)

**`back/back.int.test.ts`**
| Ca | Dữ liệu | Kỳ vọng |
|---|---|---|
| BK-01 | `pb2-back` tới B3 `waiting_review`; B: `{result:"fail", back_to_step:1}` không góp ý | 422 `FEEDBACK_REQUIRED`; task vẫn `open` |
| BK-02 | `{result:"pass", back_to_step:1}` | 422 `BACK_TARGET_INVALID`; `{fail, feedback, back_to_step:2}` (∉ `[1]`) ⇒ 422 `BACK_TARGET_INVALID` |
| BK-03 | **AC-PB2-06** `{fail, feedback:"Sai số tổng", back_to_step:1}` | 200; B1 `queued` (đúng 1 job mới), B2, B3 `pending` (D7; AC-PB2-06 đã sửa theo D7); `round=2` ở B1, B2, B3; B0 `round=1`, `done`; `attempt=1`, `current_output_id=NULL`, `passed_by=NULL` ở B1–B3; `process_runs.current_step=1`, `current_stage_idx=1`, `back_rounds=1`, `status=running` |
| BK-04 | sau BK-03 | đúng 1 hàng `process_back_events {from_stage_idx:3, from_step:3, to_step:1, round_after:2, feedback:"Sai số tổng", decided_by:B, task_id:<task>}`; thread part `task_result{result:"fail", to_step:1}`; `HistoryItem.to_step=1` |
| BK-05 | prompt job B1 | chứa `"Sai số tổng"` |
| BK-06 | output cũ | `process_outputs` B1–B3 v1 còn (`round=1`); B1 xong lần 2 ⇒ v2 `round=2`; `StageView.outputs` = [v1, v2] cũ→mới, `OutputRef.round` 1, 2 |
| BK-07 | `pb2-par` `Tổng hợp` (bước 2) chọn quay lại bước 1 (stage 1, 2 đã `done`) | stage 1, 2 cùng `queued` + 2 job, cả hai prompt chứa góp ý; stage 3 `pending` |
| BK-08 | quay lại khi stage cùng bước đích còn job chạy (`pb2-par`: `Test hồi quy` quay về bước 0 khi `Rà soát code` đang `running`) | `hub.runs` `Rà soát code` `cancelled` + NOTIFY `job_cancel`; task review mở bước ≥ 0 khác ⇒ `superseded`; job cũ trả output muộn ⇒ bị bỏ (`current_run_id` NULL), không tạo output |
| BK-09 | `team_runs` đang chạy ở stage bị reset | `cancelled` |

**`back/limit.int.test.ts`** (AC-PB2-07, D8, Q2)
| Ca | Kỳ vọng |
|---|---|
| BL-01 | đặt `back_rounds=3` (SQL), B3 chọn quay lại bước 1 | 200; **không** reset: B3 `needs_decision`, `stage_runs.back_to_step=1`, `feedback` = góp ý; run `needs_decision`, task decision `reason=back_limit`, `view.decision.back_to_step=1`; 0 event mới; 0 job mới |
| BL-02 | decision assignee | như `redo_limit` (A + Group kiểm, không `tenant_admin`) — đối chiếu P1-51 |
| BL-03 | A `decide {option:"add_attempt"}` | `back_limit=4`, `back_rounds=4`, quay lại thực hiện (B1 `queued`, round+1), event `decided_by=A`, `task_id` = task decision |
| BL-04 | `use_current` | B3 coi Đạt ⇒ run `done` (bước cuối) |
| BL-05 | `cancel` | run `cancelled` |
| BL-06 | `TaskDetail` review mở B3: `back_steps=[1]`, `back_rounds_left=3−back_rounds`; stage không `back_to_steps` ⇒ không có trường |
| BL-07 | `decide {stage_idx:2}` khi stage 2 không có decision mở | 409 `PROCESS_RUN_STATE` |

**`back/race.int.test.ts`** (AC-PB2-08, R09; 10 vòng)
| Ca | Kỳ vọng |
|---|---|
| RC-01 | `pb2-par3` bước 2 cả hai `waiting_review`: B quay lại bước 0 (`Q2a`) ∥ T quay lại bước 1 (`Q2b`); lặp với `pb2-par2` (cùng đích 0) | đúng 1×200 + 1×409 `REVIEW_TASK_CLOSED`; task kẻ thua `superseded`; đúng 1 event; `back_rounds=1`; `current_step` = đích của kẻ thắng |
| RC-02 | quay lại ∥ Đạt stage kia | một thắng; nếu quay lại thắng ⇒ Đạt 409 `REVIEW_TASK_CLOSED`; nếu Đạt thắng ⇒ quay lại vẫn chạy, stage Đạt bị reset (round+1) |
| RC-03 | quay lại ∥ huỷ run | một trong hai; run `cancelled` không bị hồi sinh (`status` không trở về `running`) |

**`back/view.int.test.ts`** (HUB-FR-113, HUB-BR-25, AC-PB2-11)
| Ca | Kỳ vọng |
|---|---|
| BV-01 | full view sau 2 lần quay lại | `back_rounds=2`, `back_limit=3`, `back_events` 2 phần tử cũ→mới, `round` 2, 3; parse `ProcessRunFullViewSchema` ok |
| BV-02 | 21 event (SQL) | `back_events` = 20 mới nhất, thứ tự cũ→mới |
| BV-03 | `ProcessRunSummary` `current_step`, `step_count=3` (`pb2-par`); `StageView.step/round/back_to_steps` (`[]` khi auto) |
| BV-04 | H (ngoài phòng, chỉ có task) GET run ⇒ task view: không khoá `back_events`, stages có `step/round` |
| BV-05 | tenant `beta` GET run `acme` ⇒ 404 |

### 3.5 Int · tok (DB `pb2_tok`) — Bàn giao + resume (HUB-FR-136 SHOULD, AC-PB2-09/10)

**`tok/handoff.int.test.ts`**
| Ca | Kỳ vọng |
|---|---|
| HO-01 | `pb2-par` stage 0 output `MD_HO` ⇒ prompt job bước 1 chứa `"Bàn giao từ bước trước:"`, `"HANDOFF-OK"`, đường dẫn `s0-v1-` ; **không** chứa `"BODY-ONLY-7f3a"`; file vẫn đính kèm (`attachments` job có file s0) |
| HO-02 | stage 0 `MD_LONGHO` ⇒ prompt có 800 ký tự `H` + `"…"`, không 801; `OutputRef.handoff_truncated=true` ở view; `MD_HO` ⇒ `false` |
| HO-03 | def tạo qua `POST /process-defs` (có `ensureHandoff`) + output `MD_NOHO` 4 lần | `needs_decision template_invalid` (thiếu "Bàn giao", như M3 cũ) |
| HO-04 | def SQL cũ (không Bàn giao) + `MD_NOHO` | template ok; stage sau prompt **không** có "Bàn giao từ bước trước:" (hành vi cũ: nguyên file đính kèm) |
| HO-05 | sau quay lại (BK-03 dạng ngắn): Bàn giao v2 thay v1 ở prompt bước sau | prompt bước 2 chứa Bàn giao của v2, không chứa v1 |
| HO-06 | stage bước 2 nhận Bàn giao của **cả** 2 stage bước 1 (`### Rà soát code`, `### Test hồi quy`) | cả hai mục có mặt |
| HO-07 | Bàn giao lấy từ `process_outputs.content` (`sectionMap`): UPDATE SQL cột `sections` thành NULL/giá trị khác trước khi stage sau chạy | prompt vẫn chứa `HANDOFF-OK`; `handoff_truncated` tính từ `content` |

**`tok/resume.int.test.ts`** (D11 — chỉ Hub; Runtime giả ghi payload)
| Ca | Kỳ vọng |
|---|---|
| RZ-01 | stage `Phân tích` Chưa đạt "Thiếu MST" (cùng agent, `cli_sessions` có hàng, stage này viết cuối) | job attempt 2: `use_session=true`; `SendMessageRequest.content` = `deltaPrompt` (chứa "Góp ý cần sửa:", "Thiếu MST"; **không** chứa "HANDOFF"/"Đầu vào"); hàng `cli_sessions` còn |
| RZ-02 | như RZ-01 nhưng xoá `cli_sessions` trước | prompt đầy đủ (có góp ý), `use_session=true`, không resume |
| RZ-03 | đổi agent stage giữa hai lần (snapshot khác — dùng run có stage `agM1` rồi sửa snapshot SQL sang `agM2` trước redo) | không resume; `cli_sessions` của (conv, agM2) bị **DELETE** trước job |
| RZ-04 | `pb2-seq-same`: stage 1 lần đầu, cùng agent `agPost` với stage 0, `cli_sessions(conv, agPost)` có hàng | stage 1 chạy mới: `cli_sessions(conv, agPost)` bị xoá trong tx launch, `use_session=true`, prompt đầy đủ (đổi hành vi P-a, plan §4.2 cuối) |
| RZ-05 | `pb2-same` bước 1 (S1a, S1b cùng `agM1`) | cả hai job `use_session=false`; `cli_sessions` không xoá |
| RZ-06 | stage `team` làm lại | `use_session=true`, không xoá session, không delta (giữ cũ) |
| RZ-07 | quay lại bước X (round 2), cùng agent, session còn | stage bước X resume + delta chứa góp ý quay lại |
| RZ-08 | **continuing**: stage hỏi lại (`waiting_answer`), người trả lời ⇒ job tiếp | `use_session=true`, prompt = prompt đầy đủ cũ (không "Góp ý cần sửa:"), `cli_sessions` còn |
| RZ-10 | `continuing` + session hết hạn ⇒ prompt cũ, hàng bị DELETE; `pb2-same` hỏi lại ⇒ prompt có khối `Câu hỏi trước:`/`Trả lời:` |
| RZ-09 | **G-7** redo cùng stage/agent, `cli_sessions.updated_at = now() − 86401 s` ⇒ chạy mới (prompt đầy đủ, hàng bị DELETE); biên `86399 s` ⇒ resume + delta |

### 3.6 Int · compat (DB `pb2_compat`) — tương thích ngược (AC-PB2-01, R14)
| Ca | Kỳ vọng |
|---|---|
| CP-01 | `hoa-don-t` (2 stage không `step`) chạy hết như P-a (P1-20…P1-42 rút gọn): tuần tự, `current_step` = `current_stage_idx` ở mọi thời điểm |
| CP-02 | run chèn SQL ở trạng thái P-a (snapshot không `step`, cột mới default) đang `waiting_review` stage 1 | Đạt ⇒ chạy tiếp/xong bình thường; view `step` = idx, `round=1`, `back_to_steps=[]` |
| CP-03 | `GET /process-runs/:id` run cũ ⇒ parse schema mới ok (`step_count` = số stage) |
| CP-04 | `real_action` def cũ: stage i-1 review ⇒ chạy; actor = người Đạt stage i-1 |
| CP-05 | thread meta cũ (OutputRef không `round`) đọc lại ⇒ không 500 |


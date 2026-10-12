# Test plan · P-b2-canvas (qc, chế độ PLAN — CHƯA viết code test, CHƯA LOCK; khoá sau Gate T3)

Nguồn: spec §1–§5, §8 (AC-PB2-01…12), PB2-R01…R18 · plan BE `5e025d89` §0 D1–D12, §1–§2 (contract + chữ ký thuần), §3–§5, §7 (đua), §8 · plan FE `b1cb2c86` §1–§7 (role/nhãn), `plan-frontend-i18n.md` (câu chữ nguyên văn). Mẫu bố cục: `../P-b-sources/test-plan.md`.
Tên test: `"<AC/FR> · <case-id> · mô tả"` (vd `"AC-PB2-02 · PI-03 · A Đạt, B chưa ⇒ bước 2 chưa chạy"`). Không `skip/only/sleep` cố định; chờ theo điều kiện (`waitFor`, `waitStatus`, `nextStageJob`, `page.waitForResponse`).

## 0. Bố cục, lệnh, DB

| Thư mục | Hậu tố | Nội dung | Chạy |
|---|---|---|---|
| `tests/acceptance/P-b2/rules/` | `*.test.ts` | hàm thuần contract + `core/step.rules`, `gates/back.rules`, `runs/{handoff,session}.rules`, `defs/def.rules.ensureHandoff`; schema zod | `bun test tests/acceptance/P-b2/rules` |
| `tests/acceptance/P-b2/s0/` | `*.int.test.ts` | migration 0024, RLS, CRUD def (422 + `details.rules`, `ensureHandoff`), contract view | DB tag `pb2_s0` |
| `tests/acceptance/P-b2/par/` | `*.int.test.ts` | engine bước song song, join, D6, asks, sweeps, quota, #135, đua §7 | DB tag `pb2_par` |
| `tests/acceptance/P-b2/back/` | `*.int.test.ts` | quay lại D7, trần `back_limit` D8, `decide stage_idx` D9, R09 đua, view `back_events`/HUB-BR-25 | DB tag `pb2_back` |
| `tests/acceptance/P-b2/tok/` | `*.int.test.ts` | Bàn giao (prompt, cắt, `handoff_truncated`), resume D11 (`use_session`, xoá `cli_sessions`), `priorFiles` theo bước | DB tag `pb2_tok` |
| `tests/acceptance/P-b2/compat/` | `*.int.test.ts` | def/run cũ không `step` (AC-PB2-01, R14) | DB tag `pb2_compat` |
| `tests/acceptance/P-b2/_support/` | — | `pb2.ts` (fixture, §1), `_modules.ts` (nạp động, mẫu `P-a/_support/modules.ts`: module vắng ⇒ `{}` ⇒ đỏ ở `expect(typeof fn).toBe("function")`, không đỏ ở import) | — |
| `e2e/P-b2/admin/`, `e2e/P-b2/chat/` | `*.pb2.ts` | Playwright; `playwright.pb2.config.ts` dựng như `e2e/P-a/_pa-stack.ts` (Hub thật + Runtime giả `_pa-runtime.ts` + admin-web + chat-web) | `bunx playwright test -c e2e/P-b2/playwright.pb2.config.ts` |

Int dùng Hub in-process + Runtime GIẢ (`ScriptRuntime`/`nextStageJob`/`jobDone` của `P-a/pf1/_local.ts`), **không** cần container. "Song song" ở int = nhiều `hub.jobs` cùng `queued` (claim được cùng lúc), không phụ thuộc slot Runtime thật (R15).

**Bẫy (bắt buộc):** mỗi thư mục int một DB riêng — `bun run db:test:create <tag>` sinh `.env.test-<tag>.local` (ghi đè **cả** `HUB_TEST_DATABASE_URL` và `AGENT_RT_TEST_DATABASE_URL`, CONVENTIONS §2 "Bẫy đã gặp"); file env cũ trỏ DB chung ⇒ chạy lại lệnh. DB tag phải có **0023 (X2b-2 B1, `8b90e0fc`) rồi 0024**; test migration kiểm `_journal` có cả hai, thứ tự 0023 < 0024. postgres.js: jsonb ⇒ `sql.json(obj)`, mảng ⇒ `sql.array`. Chạy: `bun --env-file=.env.test-<tag>.local --config=bunfig.int.toml test --timeout 60000 tests/acceptance/P-b2/<dir>`.

## 1. Fixture (`tests/acceptance/P-b2/_support/pb2.ts`; dùng lại persona/agent/Group của `P-a/_support/pa.ts` + `P-a/pf1/_local.ts`: `A` người bắt đầu, `B` Group Kế toán (người duyệt 1), `T` Group thứ hai (người duyệt 2), `H` ngoài phòng, `tadmin`; tenant `acme`, `beta`)

Def chèn bằng **SQL** (`insertDef`, không qua `ensureHandoff`) trừ ca kiểm lưu def. Hằng UUID `pb2` riêng (`idGenPa(0x2b2)`).

| Def (key) | Stage (idx · tên · `step` · executor · `after`) | Dùng cho |
|---|---|---|
| `pb2-par` | 0 `Phân tích` · 0 · agent `agPost` · review(Kế toán) · 1 `Rà soát code` · 1 · agent `agM1` · review(Kế toán) · 2 `Test hồi quy` · 1 · agent `agM2` · review(T-group) `back_to_steps:[0]` · 3 `Tổng hợp` · 2 · agent `agPost` · review(Kế toán) `back_to_steps:[0,1]` | AC-PB2-02/03/06/08, e2e chat |
| `pb2-back` | 0 `B0` · 0 · auto · 1 `B1` · 1 · review · 2 `B2` · 2 · auto · 3 `B3` · 3 · review `back_to_steps:[1]` | AC-PB2-06/07 (đúng hình AC) |
| `pb2-auto3` | 0 `X` · 0 · auto · 1 `Y1`,2 `Y2`,3 `Y3` · 1 · auto · 4 `Z` · 2 · auto | join 3 stage, ≤ 3 job, finish |
| `pb2-real` | 0 `R0a` · 0 · review · 1 `R0b` · 0 · review · 2 `Ghi sổ` · 1 · `real_action:true` · auto | `real_action` theo bước (R03), `passedBy` muộn nhất |
| `pb2-team0` / `pb2-team0p` | 0 `Nhóm đọc` · 0 · team(2 member) · auto (+ 1 `Đọc đơn` · 0 · agent · auto ở bản `p`) · 1 `Kết` · 1 · auto | #135 (R18) |
| `pb2-same` | 0 `S0` · 0 · agent `agPost` · review · 1 `S1a` · 1 · agent `agM1` · review · 2 `S1b` · 1 · agent `agM1` · review | `sessionPlan.sameAgentInStep` |
| `pb2-par2` | 0 `P0` · 0 · review · 1 `P1a` · 1 · review `back_to_steps:[0]` · 2 `P1b` · 1 · review(T-group) `back_to_steps:[0]` | R09 cùng đích, E-PB2-24 |
| `pb2-par3` | 0 `Q0` · 0 · auto · 1 `Q1` · 1 · auto · 2 `Q2a` · 2 · review `back_to_steps:[0]` · 3 `Q2b` · 2 · review(T-group) `back_to_steps:[1]` | R09 khác đích (RC-01) |
| `pb2-seq-same` | 2 stage **không** `step`, cả hai agent `agPost`, auto | RZ-04 (đổi hành vi P-a) |
| `hoa-don-t` (P-a, không `step`) | như P-a | AC-PB2-01, R14 |

Output Markdown (hằng trong `pb2.ts`):
- `MD_HO = "## Bảng ý\nBODY-ONLY-7f3a nội dung dài.\n\n## Tổng tiền\n12 000 000\n\n## Bàn giao\nHANDOFF-OK: đã đọc HD-12, tổng 12 000 000."` (đủ mục cho mọi stage; `BODY-ONLY-7f3a` là dấu để kiểm **không** nhúng nguyên file).
- `MD_NOHO` = `MD_HO` bỏ `## Bàn giao` (def cũ / ca thiếu mục).
- `MD_LONGHO` = `MD_HO` với Bàn giao = `"H".repeat(900)` (> 800 ký tự ⇒ cắt). Biên: `"H".repeat(800)` (không cắt), `"H".repeat(801)` (cắt).
- `cli_sessions` giả: INSERT `hub.cli_sessions(conversation_id, agent_id, provider_key, tenant_id, session_id='fake-sess-1', …)` bằng SQL cho ca resume.

## 2. Ma trận AC × ca × loại
Loại: **R** thuần · **C** contract zod · **I** int · **E** e2e.

| AC / FR | Ca | Loại |
|---|---|---|
| **AC-PB2-01** def cũ chạy như P-a; `current_step=current_stage_idx`; strip như cũ · PB2-R14 | CP-01…CP-05 · RS-01 · M-03 · E-PB2-20b · hồi quy `done:pa` | I, R, E |
| **AC-PB2-02** bước song song khởi động cùng lúc, join | PI-01…PI-07 · RS-04…RS-08 | I, R |
| **AC-PB2-03** A trượt, B Đạt ⇒ chỉ A làm lại | PI-08, PI-09 (D6) | I |
| **AC-PB2-04** `STEP_TOO_WIDE`/11 stage/`STEP_INCOMPLETE`/`STEP_ORDER` | RD-01…RD-12 · DF-01…DF-04 | R, I |
| **AC-PB2-05** `real_action` theo bước | RD-13…RD-16 · RS-12…RS-14 · PI-12 | R, I |
| **AC-PB2-06** quay lại bước X | RB-01…RB-08 · BK-01…BK-08 | R, I |
| **AC-PB2-07** trần 3 vòng ⇒ `back_limit` ⇒ `add_attempt` | RB-09…RB-11 · BL-01…BL-05 | R, I |
| **AC-PB2-08** hai người duyệt cùng chọn quay lại | RC-01…RC-03 | I (đồng thời) |
| **AC-PB2-09** `## Bàn giao` vào prompt, không nhúng file; thiếu ⇒ `template_invalid` | RH-01…RH-08 · DF-05…DF-08 · HO-01…HO-06 | R, I |
| **AC-PB2-10** resume cùng agent; đổi agent ⇒ không | RR-01…RR-07 · RS-01b · RZ-01…RZ-06 | R, I |
| **AC-PB2-11** RLS `process_back_events`; ngoài phòng không lộ `back_events` | M-05…M-08 · BV-04, BV-05 · E-PB2-27 | I, E |
| **AC-PB2-12** e2e admin canvas + chat | E-PB2-01…E-PB2-12 · E-PB2-20…E-PB2-28 | E |
| HUB-FR-104 (mô hình bước) | RD-*, C-*, DF-* | R, C, I |
| HUB-FR-106 (engine song song, input theo bước) | PI-*, HO-*, PF-01…PF-03 | I |
| HUB-FR-113 (lịch sử quay lại) | BV-01…BV-05, E-PB2-25 | I, E |
| HUB-FR-118 (quay lại) | RB-*, BK-*, BL-*, RC-* | R, I |
| HUB-FR-136 (Bàn giao + resume, SHOULD) | RH-*, RR-*, HO-*, RZ-* | R, I |
| HUB-BR-38 (a,b,c,d) | PI-*, RD-*, BK-* | R, I |
| ADM-FR-71 (canvas) | E-PB2-01…E-PB2-12 | E |
| CHAT-AC-59 / CHAT-AC-60 | E-PB2-20…E-PB2-28 | E |
| TECH-DEBT #135 (R18) | PT-01, PT-02 | I |

## 3. Ca cụ thể

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

**`rules/handoff-session.test.ts`** — `runs/handoff.rules.ts`, `runs/session.rules.ts`, `defs/def.rules.ts`
| Ca | Kỳ vọng |
|---|---|
| RH-04 | `handoffBlock([])` ⇒ `null`; mọi `handoff:null` ⇒ `null` |
| RH-05 | `handoffBlock([{name:"Phân tích", file:"s0-v1-phan-tich.md", handoff:"HANDOFF-OK"}])` chứa `"Bàn giao từ bước trước:"`, `"### Phân tích (s0-v1-phan-tich.md)"`, `"HANDOFF-OK"` |
| RH-06 | handoff 900 ký tự ⇒ khối chứa 800 ký tự + `"…"`, không chứa ký tự 801 |
| RH-07 | `ensureHandoff`: thiếu ⇒ `required_sections` thêm `"Bàn giao"` **cuối**, `template` thêm `"\n\n## Bàn giao\n"` cuối; có sẵn `" bàn GIAO "` (trim/lower) ⇒ không đổi (không trùng); đã có ⇒ idempotent (gọi 2 lần = 1 lần) |
| RH-08 | `ensureHandoff` khi `required_sections` đã 20 mục hoặc `template` > 20 000 − len ⇒ không thêm (giữ hợp lệ schema) |
| RR-01 | `sessionPlan({executor:"team", …})` ⇒ `{useSession:true, resume:false, clearSession:false}` |
| RR-02 | `sameAgentInStep:true` ⇒ `{false,false,false}` |
| RR-03 | `rerun ∧ lastWriterIsSelf ∧ sessionExists` ⇒ `{true,true,false}` |
| RR-04 | `rerun:false` (lần đầu) ⇒ `{true,false,true}` (chạy mới, xoá session) |
| RR-05 | `rerun ∧ ¬lastWriterIsSelf` (đổi agent / agent khác viết sau) ⇒ `{true,false,true}`; `¬sessionExists` ⇒ `{true,false,true}` |
| RR-06 | `deltaPrompt("Thiếu MST", null)` bắt đầu `"Góp ý cần sửa:\n"` chứa `"Thiếu MST"`, **không** chứa `"Mục cần sửa"`; `("x", ["Tổng tiền"])` chứa `"Mục cần sửa: Tổng tiền"` |
| RR-07 | `deltaPrompt` không chứa nội dung "Đầu vào"/Bàn giao (chỉ delta) |

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
| DF-01 | `POST /process-defs` 4 stage cùng `step:1` ⇒ 422 `PROCESS_DEF_INVALID`, `details.paths` có `stages.4.step`, `details.rules` cùng chỉ số = `STEP_TOO_WIDE` |
| DF-02 | 11 stage ⇒ 422 lỗi **cũ** (schema max 10, không `STEP_TOO_WIDE`) |
| DF-03 | thiếu `step` ở 1 stage ⇒ `STEP_INCOMPLETE`; `step [0,2]` ⇒ `STEP_ORDER` (cả `PUT` và `POST …/copy` không áp vì copy từ mẫu hợp lệ — chỉ kiểm POST/PUT) |
| DF-04 | `back_to_steps:[2]` ở stage bước 2 ⇒ `BACK_TARGET_INVALID` path `stages.<i>.after.back_to_steps.0` |
| DF-05 | `real_action` bước 2, bước 1 {review, auto} ⇒ 422 `REAL_ACTION`; {review, review} ⇒ 201 |
| DF-06 | `ensureHandoff` (R10): POST def không có "Bàn giao" ⇒ response + GET có `required_sections` kết thúc `"Bàn giao"`, `template` kết thúc `"## Bàn giao\n"`; PUT lại cùng body ⇒ không nhân đôi; `POST /process-defs/:tpl/copy` ⇒ bản chép có "Bàn giao" |
| DF-07 | mẫu platform (seed) **không** đổi sau migrate (GET mẫu `sdlc` ⇒ không có "Bàn giao") |
| DF-08 | `tenant_admin` tenant `beta` PUT def `acme` ⇒ 404 (không lộ, hồi quy cách ly) |

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
| PI-09 | **D6** B Đạt stage 1 khi stage 2 còn task review mở | task stage 2 vẫn `open` (không `superseded`); task stage 1 `done` |
| PI-10 | stage 1 output M3 thiếu mục 4 lần ⇒ `needs_decision template_invalid` | run `needs_decision`; stage 2 vẫn chạy nốt tới `waiting_review`; bước 2 không khởi động; `view.decision.stage_idx = 1` |
| PI-11 | huỷ run khi bước 1 có 2 job | cả 2 `hub.runs` `cancelled`, mọi task mở `cancelled` (huỷ = cả run) |
| PI-12 | `pb2-real`: R0a Đạt bởi B (10:00), R0b Đạt bởi T (sau) | `Ghi sổ` chạy; audit actor = T (người Đạt muộn nhất); nếu đổi R0b thành auto (def khác) ⇒ không tạo được def (DF-05) |
| PI-13 | quota R15: A có `max_concurrent_process_runs=1`, run `pb2-auto3` đang ở bước 1 (3 job) | A start run 2 ⇒ 429 `TOO_MANY_PROCESS_RUNS` (đếm run); 3 job bước 1 đều `user_id = A` |
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
| BK-03 | **AC-PB2-06** `{fail, feedback:"Sai số tổng", back_to_step:1}` | 200; B1 `queued` (đúng 1 job mới), B2, B3 `pending` (D7 — xem §6 G2 về câu chữ AC); `round=2` ở B1, B2, B3; B0 `round=1`, `done`; `attempt=1`, `current_output_id=NULL`, `passed_by=NULL` ở B1–B3; `process_runs.current_step=1`, `current_stage_idx=1`, `back_rounds=1`, `status=running` |
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

### 3.6 Int · compat (DB `pb2_compat`) — tương thích ngược (AC-PB2-01, R14)
| Ca | Kỳ vọng |
|---|---|
| CP-01 | `hoa-don-t` (2 stage không `step`) chạy hết như P-a (P1-20…P1-42 rút gọn): tuần tự, `current_step` = `current_stage_idx` ở mọi thời điểm |
| CP-02 | run chèn SQL ở trạng thái P-a (snapshot không `step`, cột mới default) đang `waiting_review` stage 1 | Đạt ⇒ chạy tiếp/xong bình thường; view `step` = idx, `round=1`, `back_to_steps=[]` |
| CP-03 | `GET /process-runs/:id` run cũ ⇒ parse schema mới ok (`step_count` = số stage) |
| CP-04 | `real_action` def cũ: stage i-1 review ⇒ chạy; actor = người Đạt stage i-1 |
| CP-05 | thread meta cũ (OutputRef không `round`) đọc lại ⇒ không 500 |

## 4. E2E (`e2e/P-b2/`, nhãn **nguyên văn** plan-fe §7 + i18n; số bước hiển thị theo §6 G1)

Fixture e2e (`e2e/P-b2/_pb2-data.ts`, SQL như `_pa-data.ts`): def `pb2-par` + `pb2-full` (bước 1 có 3 stage) + mẫu platform `sdlc`; run seed (`seedRun` mở rộng): (a) `pb2-par` bước 1 cả hai `waiting_review`; (b) run có 2 `back_events`, stage 1 có v1/v2; (c) run `needs_decision back_limit`. DB `pb2_e2e` (DROP schema như `done-pb`).

**Admin — `e2e/P-b2/admin/canvas.pb2.ts` (ADM-FR-71, AC-PB2-12)**
| Ca | Thao tác | Kỳ vọng |
|---|---|---|
| E-PB2-01 | mở `pb2-par` | `application "Canvas quy trình"`; 4 `button` `/^Giai đoạn [1-4]: /`; `complementary "Chi tiết giai đoạn"` chứa `region "Giai đoạn 1: Phân tích"` (chọn sẵn, FB7) |
| E-PB2-02 | click `button /^Giai đoạn 3: Test hồi quy/` | panel đổi sang `region "Giai đoạn 3: Test hồi quy"`; `spinbutton "Chạy ở bước"` giá trị = bước của stage |
| E-PB2-03 | focus node `Giai đoạn 2: Rà soát code` + `Alt+ArrowRight` | `status` "Giai đoạn n chuyển sang bước m" (n theo mảng sau sắp); `spinbutton` cập nhật; trang **không** lùi lịch sử (URL giữ) |
| E-PB2-04 | kéo node `Tổng hợp` (mouse) sang cột của bước 2 | bước đổi; giờ cột đó có 3 stage |
| E-PB2-05 | `pb2-full`: `Alt+ArrowRight` stage bước 0 sang bước 1 (đã 3) | `alert` chứa "Bước n đã đủ 3 giai đoạn song song." + status "Không chuyển được: bước n đã đủ 3 giai đoạn"; bước không đổi; `button "Thêm giai đoạn vào bước n"` `aria-disabled=true` |
| E-PB2-06 | panel `Tổng hợp`: `group "Nếu bị trượt"` → `checkbox "Quay lại bước n"` → `Lưu` (chờ PUT 200) → reload | checkbox vẫn checked; node có chữ "↩ bước n"; GET def `back_to_steps` đúng, `required_sections` có `"Bàn giao"` |
| E-PB2-07 | stage bước đầu | khối "Nếu bị trượt" có câu "Bước đầu không có bước nào phía trước."; stage gate tự động ⇒ không có `group "Nếu bị trượt"` |
| E-PB2-08 | `real_action`: stage bước sau khi bước trước có stage auto | `switch "Hành động thật"` disabled (câu `realLocked` mới); đổi stage đó sang duyệt ⇒ enabled |
| E-PB2-09 | panel nút `Chuyển sang bước sau` / `Tách sang bước riêng` / `Lên` / `Xuống` (không dùng phím) | bước/thứ tự đổi giống E-PB2-03 (đường a11y thay thế, FB8) |
| E-PB2-10 | `tablist "Chế độ xem"` → `Danh sách` | danh sách theo bước với `button "Giai đoạn n: …"`; panel vẫn hoạt động. Biến thể: `page.route("**/canvas*.js", abort)` ⇒ `alert` "Không tải được canvas. Đang dùng dạng danh sách." + `button "Thử lại"`; viewport 700 px ⇒ mặc định Danh sách |
| E-PB2-11 | focus node + `Enter` | panel mở, focus ở `textbox "Tên giai đoạn"`; `Delete` ⇒ `alertdialog "Xoá giai đoạn “…”?"` |
| E-PB2-12 | mẫu `sdlc` | "Đây là quy trình mẫu, chỉ xem. Chép mẫu để chỉnh sửa." + "Quy trình mẫu: chỉ xem, không kéo thả được."; không `button "Thêm giai đoạn"`; `Alt+ArrowRight` không đổi gì |

**Chat — `e2e/P-b2/chat/run.pb2.ts` (CHAT-AC-59/60, HUB-FR-113, AC-PB2-12)**
| Ca | Kỳ vọng |
|---|---|
| E-PB2-20 | run `pb2-par` trong phòng: `list "Tiến độ quy trình"` 3 `listitem`; con `list "Bước n — chạy song song"` 2 mục (Rà soát code, Test hồi quy) |
| E-PB2-20b | run `hoa-don-t` (cũ): strip không có chữ "Bước" (giao diện cũ, AC-PB2-01) |
| E-PB2-21 | seed (a): 2 thẻ duyệt nhóm dưới `group "Bước n"` (Q7) |
| E-PB2-22 | thẻ `Test hồi quy`: `button "Chưa đạt"` → `radiogroup "Chưa đạt thì…"`: `radio "Làm lại giai đoạn này"` checked, `radio "Quay lại bước n"`; chọn quay lại ⇒ `note` "Còn 3 lần quay lại. Các bước từ n trở đi sẽ chạy lại; kết quả cũ vẫn xem được."; bấm `Gửi chưa đạt` khi trống ⇒ câu lỗi góp ý cũ; điền `textbox "Góp ý"` "Thiếu ca hồi quy" ⇒ toast "Đã quay lại bước n. Các giai đoạn sẽ chạy lại với góp ý của bạn."; sau khi Runtime giả chạy lại ⇒ strip có `×2` |
| E-PB2-23 | thẻ `Rà soát code` (không `back_to_steps`) | không có `radiogroup` (hành vi cũ) |
| E-PB2-24 | 2 người (B, T — 2 context) cùng quay lại ở seed (a) với def `pb2-par2` | một toast thành công; người kia toast "Giai đoạn này vừa được xử lý ở bước khác. Đã cập nhật." và thẻ đóng |
| E-PB2-25 | seed (b) trang Run `/runs/:id` | `group "Bước n"` (+ "×2 lần"); `list "Lịch sử quay lại"` 2 `listitem` chứa "Vòng 2 · … → quay lại bước n"; `tab /^Bản 1/`, `tab /^Bản 2/` (Bản 2 "mới nhất" chọn sẵn) |
| E-PB2-26 | seed (c) thẻ "Cần người quyết": "Đã quay lại tối đa 3 lần mà chưa đạt." + 3 nút sẵn có; bấm nút add_attempt (nhãn: §6 G4) ⇒ run chạy lại (strip `×` tăng) |
| E-PB2-27 | H (ngoài phòng, có task) mở Run | không có `list "Lịch sử quay lại"` (AC-PB2-11) |
| E-PB2-28 | strip seed (b): dòng "↩ Quay lại bước n (lần 2)"; run `back_rounds=3` ⇒ "Đã quay lại tối đa 3 lần" |

## 5. Test khoá cũ — sửa có chủ đích ở T2 (qc, TRƯỚC relock; không phải "Tranh chấp")

| File · ca | Sửa | Lý do (nguồn) |
|---|---|---|
| `P-a/step0/rules/contracts-pa.test.ts` L162 | `toHaveLength(15)` ⇒ `16` (+ kiểm phần tử cuối `back_limit`) | plan §1.1, §8 |
| cùng file L178–200 (tên "đúng 12 mã") | thêm `BACK_TARGET_INVALID: 422`; đổi tên "13 mã" | plan §1.1 |
| `P-b/pfs3/_local.ts` (`mkDef` qua `POST /process-defs` + `MD_AUTO`/`mdWithRefs`) | output fixture thêm `## Bàn giao` (vì `ensureHandoff` ⇒ thiếu = `template_invalid`) | R10, Q3, plan §8 dòng 4 |
| `e2e/P-b/_pb-support.ts` (`mkDef` API, template `## Kết quả`) + `e2e/P-b/_pb-runtime.ts` output | thêm `## Bàn giao` vào output runtime giả cho def tạo qua API | như trên |
| `e2e/P-a/_pa-runtime.ts` L160 mặc định `"## Kết quả\nxong.\n"` | thêm `## Bàn giao` **nếu** ca nào chạy def đã qua `Lưu` (E-P15b lưu `hoa-don-t` ⇒ run `hoa-don-t` sau đó trong cùng DB e2e sẽ thiếu mục) — kiểm thứ tự chạy ở WRITE | R10 |
| `P-a/pf1/gates.int.test.ts` P1-42/45/47 | chỉ chạy lại, dự kiến **không** đổi (tuần tự: D6 đóng task của stage = mọi task) | D6 |
| `P-a/pf2/resume.int.test.ts` | kiểm lại; ca nào kỳ vọng stage sau **cùng agent** dùng session stage trước ⇒ đổi sang "chạy mới, `cli_sessions` bị xoá" | D11, plan §4.2 cuối |
| `P-a/step0/migration.int.test.ts`, `rls.int.test.ts` | dự kiến không đổi (kiểm bảng của 0019, không đếm toàn schema); ca mới ở `P-b2/s0` | plan §8 |
| mock `ProcessRunView` trong e2e chat P-a/P-b (route giả, nếu có) | thêm trường bắt buộc `current_step`, `step_count`, `step`, `round`, `back_to_steps`, `back_rounds`, `back_limit`, `back_events:[]` | contract strict |
| **E-P15b** `e2e/P-a/pf4/admin-editor.pa.ts` | dự kiến giữ nguyên (`region "Giai đoạn 1: …"` vẫn có, chọn sẵn); nếu `switch "Hành động thật"` nằm ngoài `region` sau tách `StageForm` ⇒ đổi scope sang `complementary "Chi tiết giai đoạn"` | FB7, #136 |
| **E-PB08 / E-PB09** `e2e/P-b/admin/editor.pb.ts` | `stage1()` giữ; ca chạm stage ≠ 1 ⇒ click `button "Giai đoạn n: …"` trước; kiểm câu tự thêm Bàn giao không làm hỏng so sánh template | FB7, R10 |
| `X2b2/regress.int.test.ts` (def API, `stageLauncher` giả) | chạy lại; dự kiến không đổi (không kiểm template) | R10 |

Mỗi sửa: commit riêng `test(p-b2): cập nhật test khoá <file> [HUB-FR-104]`, ghi dòng vào §8 "Kết quả" (cũ ⇒ mới, lý do). Sau T2: `tests/.lock` tính lại toàn bộ `tests/acceptance/**` + `e2e/**`.

**"Tranh chấp test" (sau LOCK):** agent code **không** sửa test; ghi vào spec §10: `- [T#·agent] <file> · "<tên test>" · kỳ vọng test ≠ <nguồn spec/plan, dòng> · đề xuất`. qc VERIFY đối chiếu BA → plan: test sai ⇒ sửa test + `tests/.lock` + ghi lý do vào §10 (đánh dấu "đã xử lý — test sửa") và §8 file này; test đúng ⇒ "đã xử lý — trả về <agent>"; BA mơ hồ ⇒ hard stop, báo điều phối.

## 6. Lỗ hổng spec / cần bổ sung (không chặn viết phần còn lại)

| # | Điểm | Mặc định qc dùng | Ai chốt |
|---|---|---|---|
| G1 | **Số bước hiển thị**: contract `step` 0-based; UI "Bước {{n}}", "Quay lại bước {{step}}", `spinbutton "Chạy ở bước"` (plan-fe: 0…9) không nói +1. AC-PB2-06 "quay lại bước 1" dùng số contract | UI hiển thị **step+1** (khớp "Giai đoạn n" = idx+1), spinbutton 1…10; e2e viết theo đó. Sai ⇒ sửa e2e trước LOCK | frontend-lead (ghi spec §9) |
| G2 | AC-PB2-06 ghi "stage bước 1–3 `queued`" ≠ D7 (bước X `queued`, > X `pending`) | test theo **D7** (BK-03); cần sửa câu AC | docs-architect |
| G3 | `backResetPlan` có trả stage bước < X? | không trả (RB-11) | backend-lead xác nhận |
| G4 | Nhãn nút `add_attempt` khi `reason=back_limit` (plan §1.4 B5 "+1 vòng") không có key i18n | giữ nhãn nút cũ; E-PB2-26 chọn nút theo nhãn cũ | frontend-lead |
| G5 | R10 "cảnh báo trong output" khi cắt Bàn giao: chỉ có `OutputRef.handoff_truncated`, không có câu chữ UI | chỉ kiểm API (HO-02), không e2e | frontend-lead (nếu muốn hiển thị) |
| G6 | `pickDecisionStage` hoà `createdAt` | không test hoà | — |
| G7 | `runStatusOf([])` / có `cancelled` trong bước | không test | — |
| G8 | `done:pb2` (script `tools/scripts/src/done-pb2.ts`) ngoài quyền sửa của qc | §7 đặc tả bước | backend-lead (T11) |
| G9 | Fake runtime e2e cần chạy 2–3 job cùng bước + kịch bản theo `stage_idx` (đã có `rtScript(target, stageIdx, …)`) — kiểm khả năng claim song song | dùng `rtScript` mỗi stage | qc kiểm ở WRITE; thiếu ⇒ backend-lead |

## 7. Cổng `done:pb2` (đề xuất; mẫu `done-pb.ts`, dừng ở bước đỏ đầu, `--from`, `--skip=int,e2e`)
1. Tĩnh: `bun run check` (biome) · `bun run typecheck` · `bun run i18n:check` · `bun run check:size`.
2. Contract + rules: `bun test packages/contracts` · `bun test tests/acceptance/P-b2` (rules; bunfig bỏ `*.int`) · `bun test apps/hub-api apps/admin-web apps/chat-web` (unit dev: `step-ops`, `canvas-layout`, `groupBySteps`, `check-bundle`).
3. Int P-b2: mỗi lát `db:test:create <tag>` + `bun --env-file=.env.test-<tag>.local --config=bunfig.int.toml test --timeout 60000 tests/acceptance/P-b2/<dir>` cho `s0`, `par`, `back`, `tok`, `compat`.
4. Hồi quy liên quan (int): `P-a/step0`, `P-a/pf1`, `P-a/pf2`, `P-a/scenario` (tag `pa_*` sẵn có) · `P-b/pfs1`, `P-b/pfs3`, `P-b/pfs4` · `X2b2/regress`. (Bỏ `P-b/pfs2` stack — không chạm Runtime; chạy trong `done:pb` đủ ở T11.)
5. Build + bundle: `bun run --filter @ai/admin-web build && bun run --filter @ai/admin-web check:bundle` (chunk `canvas*` ≤ 80 KB, initial không đổi) · `bun run --filter @ai/chat-web build && … check:bundle`.
6. E2E: DB `pb2_e2e` (DROP schema) → `bunx playwright test -c e2e/P-b2/playwright.pb2.config.ts`; hồi quy `-c e2e/P-a/playwright.pa.config.ts e2e/P-a/pf4 e2e/P-a/scenario` và `-c e2e/P-b/playwright.pb.config.ts e2e/P-b/admin e2e/P-b/chat`.
7. Khoá/truy vết: `bun run test:lock:verify` · `bun run trace --check`.
T11 vẫn chạy **đủ** `done:pa` và `done:pb` một lần (spec §8).

## 8. Kết quả (điền ở WRITE/VERIFY)
### Đỏ đúng lý do (bắt buộc trước LOCK)
| Lát | DB tag | Số ca | Đỏ ở | Ghi chú |
|---|---|---|---|---|
| rules | — | — | — | chưa viết |
| s0 / par / back / tok / compat | `pb2_*` | — | — | chưa viết |
| e2e admin / chat | `pb2_e2e` | — | — | chưa viết |
### Sửa test khoá (§5)
- (chưa)

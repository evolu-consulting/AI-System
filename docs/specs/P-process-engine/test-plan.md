# Test plan · P-process-engine · P-a (qc, chế độ WRITE/PLAN — chưa viết test, chưa LOCK)

**Vòng sửa 2 (2026-10-10, sau readiness lần 1):** U1 run phòng = thread (plan-thread) · U2 Import/Export ⇒ P-b (**không** có ca ở P-a) · U3 `sequential` · U4 M4/M5 · readiness #1 (ask do PF1 mở), #2/#3 (`canAct`, `decisionAssignees`, `TaskDetail` decision), #5 (cổng merge theo bước), #6 (seam §7.1), #7 (C2 = P1-36 + `M-C2`), #16. **Vòng 2b** (readiness lần 2): U5 starter rời phòng (P1-75, P1-85, hàng ma trận A', R-A08, E-P20) · R2-2 (E-P19, E-P20) · R2-5 (E-P9 `task_kind`) · R2-7 (N10 đóng) · R2-8.

Nguồn: spec §2, §2.1, §8, §9 (M1–M6, C1–C5, U1–U4) · plan §3–§5, §8–§10 · plan-thread · plan-step0 · plan-contract §1–§9 (§7.1 seam) · plan-seed D18 · plan-frontend-e2e §1–§3 · BA-H §6.10 (HUB-FR-104…117, HUB-BR-23…28), §11 AC-H28…H34 · usecases-chat CHAT-AC-51…58 · ba-admin ADM-FR-65…67. Phụ lục: [`test-plan-int.md`](test-plan-int.md) (ca int từng PF + ma trận cách ly + kịch bản seed) · [`test-plan-e2e.md`](test-plan-e2e.md) (e2e chat-web + admin-web). Test viết ở **QC1** (sau Gate); runtime = runtime giả claim `hub.jobs` (mẫu `H1/_runtime.ts`, `X2b/_x2b.ts runtimeUsage`), provider `fake-cli`, không Dify thật / `claude-sub`.

## 1. Bố cục theo feature (CR-059) + lệnh chạy
| Nhóm | Thư mục int/luật | Thư mục e2e | Phụ thuộc code | Nhánh chạy |
|---|---|---|---|---|
| **Bước 0** (B1, B2, B0, B3) | `tests/acceptance/P-a/step0/{rules,*.int.test.ts}` (gồm thread: outbox/poster, T7, đọc tin `process`) | `e2e/P-a/step0/` (E-P16 cờ off) | 0019, contract, khung, defs/seed | mọi nhánh (luôn chạy) |
| **PF1** chạy + cổng kiểm + mở ask/decision + tin thread | `tests/acceptance/P-a/pf1/…` | `e2e/P-a/pf1/` | Bước 0 | `feat/pa-pf1-run-gate` |
| **PF2** trả lời + nhờ trả lời | `tests/acceptance/P-a/pf2/…` | `e2e/P-a/pf2/` | Bước 0 (fixture SQL `waiting_answer`, `stageLauncher` giả); **⇢PF1** cần PF1 trên `main` | `feat/pa-pf2-ask` |
| **PF3** ngoài phòng + báo việc | `tests/acceptance/P-a/pf3/…` | `e2e/P-a/pf3/` | Bước 0 (fixture SQL `review_tasks`); **⇢PF1** cần `GET /process-runs/:id`, decision | `feat/pa-pf3-outside` |
| **PF4** token + Evolu Control | `tests/acceptance/P-a/pf4/…` | `e2e/P-a/pf4/` (chat + admin) | Bước 0 (fixture SQL usage); **⇢PF1** e2e admin "Chạy", P4-07 | `feat/pa-pf4-usage-admin` |
| **Kịch bản** (liên PF) | `tests/acceptance/P-a/scenario/` | `e2e/P-a/scenario/` | PF1–PF4 trên `main` (SC/E-S kiểm Token) | chỉ cổng merge PF4 + `done:pa` |

- Nhánh PF*n* (chạy trong nhánh): `bun test tests/acceptance/P-a/{step0,pf<n>}/**/rules` + `test:int` trên `tests/acceptance/P-a/{step0,pf<n>}` + `bunx playwright test -c e2e/P-a/playwright.pa.config.ts --project=step0 --project=pf<n>`. Ca **⇢PFk** đỏ trên nhánh cho tới khi PFk vào `main`; chủ nhánh không coi là hồi quy.
- **Cổng merge** (readiness #5; thứ tự PF1 → PF3 → PF2 → PF4; chạy trên nhánh đã rebase lên `main`). Tập = `step0` + pf của các nhánh **đã merge** + pf nhánh đang merge; ca ⇢PFk chỉ tính khi PFk thuộc tập. Mọi bước + test khoá cũ (H1, H2b, C1, X2a, X2b — cờ off **và** on):

| Bước merge | int + rules (`tests/acceptance/P-a/…`) | e2e project | Ca ⇢ được tính | Không chạy |
|---|---|---|---|---|
| 1 · PF1 | `step0`, `pf1` | `step0`, `pf1` | — | pf2–pf4, `scenario` |
| 2 · PF3 | `step0`, `pf1`, `pf3` | `step0`, `pf1`, `pf3` | PF3 ⇢PF1 (P3-07, P3-08, P3-10, P3-12, E-P12, E-P18) | pf2, pf4, `scenario` |
| 3 · PF2 | `step0`, `pf1`, `pf3`, `pf2` | + `pf2` | PF2 ⇢PF1 (P2-04 phần job, P2-11, E-P8 phần chạy tiếp) | pf4, `scenario` |
| 4 · PF4 | toàn bộ `P-a/**` gồm `scenario` | toàn bộ gồm `scenario` | PF4 ⇢PF1 (P4-07, E-P15c) + SC-1/2, E-S1/2 | — |
| `done:pa` | như bước 4 + §6 | như bước 4 | tất cả | — |
- Thứ tự merge khác (điều phối đổi) ⇒ áp cùng quy tắc "step0 + đã merge + đang merge"; ca ⇢PFk với PFk chưa merge **không** chặn cổng, ghi vào "Ghi chú bàn giao".
- Tên test: `"<mã> · <case-id> · mô tả"` (vd `"AC-H28 · P1-40 · Chưa đạt thiếu góp ý ⇒ 422 FEEDBACK_REQUIRED"`), để `trace` nối.
- Helper: `tests/acceptance/P-a/_pa.ts` (setup DB, persona, quy trình fixture, runtime giả, `waitFor`), `_modules.ts` (nạp động file luật — vắng ⇒ `{}`), `_schema.ts` (`hasPaSchema(sql)` = `to_regclass('hub.process_runs') IS NOT NULL`). Mỗi PF chỉ import `_pa.ts` + file trong thư mục mình (không import chéo PF).
- **DB riêng mỗi worktree (TECH-DEBT #17):** mỗi session/worktree tạo DB test riêng `bun run db:test:create pa_<pf>` (vd `ai_system_pa_pf1_test`) + `.env.test-<pf>.local` (`HUB_TEST_DATABASE_URL`), Redis DB riêng (`PA_REDIS_DB`: step0=10, pf1=11, pf2=12, pf3=14, pf4=9) và cổng e2e riêng (`PA_E2E_PORT_BASE`: pf1 41xx, pf2 42xx, pf3 43xx, pf4 44xx). Không chạy song song hai bộ trên cùng DB. qc dùng `ai_system_qc_test`.

## 2. Persona + dữ liệu chung (dùng lại fixture H1/X2a; tenant `acme`, khác tenant `beta`)
| Vai | User | Thuộc | Dùng cho |
|---|---|---|---|
| A người bắt đầu | `lan` | phòng R; grant mọi agent stage | starter, quota/usage |
| B người kiểm trong phòng | `hoa` | phòng R; Group "Kế toán", "PO", "Tech lead" | gate, decide `redo_limit` |
| X thành viên khác | `tam` | phòng R; không Group kiểm | thấy run, không nút |
| T người kiểm ngoài phòng ("Thomas") | `cuc` | **không** ở R; Group "Kế toán", "Tech lead" | HUB-BR-25 |
| H người được nhờ | `q01` | không ở R, không Group | forward ask |
| H2–H4 | `q02`–`q04` | như H | chuỗi chuyển |
| L rời phòng | `q05` | từng ở R (`left_at`) | mất quyền xem |
| Adm | `tadmin` (tenant_admin acme) | — | xem/huỷ/quyết, admin-web |
| P | `padmin` (platform_admin) | — | mẫu, `?tenant_id` |
| D tenant khác | `an` (beta) + `tadmin_beta` | — | 404 |
| K bị khoá | `khoa` (locked) | — | đích chuyển sai, `user_inactive` |
Agent fixture (fake-cli, bật cho acme): `hd-read` (stage 1 hoá đơn), `hd-post` (stage 2, workflow `side_effect` `ghi-so` mock H2a), `rv-a`, `rv-b`; nhóm `qc-team` (3 thành viên `m1`/`m2`/`m3`, mục sở hữu "Phần A/B/C", `sequential`) + `lead-team` (`lead_plan`). Quy trình fixture: `hoa-don-t` (= mẫu hoá đơn: stage 1 gate "Kế toán", stage 2 `real_action`), `p-auto` (2 stage auto), `p-team` (stage nhóm). Kịch bản dùng mẫu seed thật `sdlc` / `hoa-don` (test-plan-int §7).

## 3. Bản đồ phủ (yêu cầu → PF → file → ca)
| Mã | PF | File (dưới `tests/acceptance/P-a/` hoặc `e2e/P-a/`) | Ca |
|---|---|---|---|
| HUB-FR-104 (tối thiểu; Import/Export ⇒ P-b, U2) | 0 | `step0/defs.int`, `step0/seed.int`, `step0/rules/def` | S0-20…S0-33, R-DF* |
| HUB-FR-105 | PF1 | `pf1/start.int`; `pf1/rules/gate` | P1-01…P1-14, R-G05–06 |
| HUB-FR-106 | PF1 | `pf1/stage.int`, `pf1/rules/template` | P1-20…P1-29, R-TM* |
| HUB-FR-107 | PF1 | `pf1/gates.int`, `pf1/rules/gate` | P1-40…P1-50, R-G03–04 |
| HUB-FR-109 | PF1 | `pf1/real-action.int`, `pf1/rules/gate` | P1-60…P1-62, R-G01–02 |
| HUB-FR-110 | PF1 (mở ask), PF2 (trả lời) | `pf1/ask-open.int`, `pf2/ask.int`, `pf1/rules/team`, `step0/rules/task` | P1-37…P1-39, P2-02, P2-11, R-T06, R-TK04 |
| HUB-FR-111 | PF2 | `pf2/forward.int`, `pf2/rules/ask` | P2-03…P2-09, P2-12…P2-15, R-AK* |
| HUB-FR-112 | PF3 | `pf3/inbox.int`, `pf3/rules/notify` | P3-01…P3-09, R-N* |
| HUB-FR-113 | 0, PF1–PF3 | `pf1/view.int`, `pf1/isolation.int`, `step0/thread*.int`, `pf1/thread.int`, `pf2/thread.int`, `pf3/outside.int` | P1-70…P1-77, P1-80…P1-89, S0-08, S0-09, S0-14…S0-19, P2-16, P3-10, P3-11, M-* |
| HUB-FR-114 (nhóm seed) | PF1 | `pf1/team.int`, `pf1/rules/team` | P1-30, P1-31, P1-33, P1-34, R-T* |
| HUB-FR-115 | PF1 | `pf1/team.int`, `pf1/stage.int`, `step0/rules/limits` | P1-25, P1-26, P1-28, P1-32, R-L* |
| HUB-FR-116 | PF1 | `pf1/stage.int` | P1-27 |
| HUB-FR-117 (vế run) | PF4 | `pf4/usage.int`, `pf4/rules/usage` | P4-01…P4-07, R-U* |
| HUB-BR-23 (+ ngoại lệ C2 stage nhóm) | PF1 | `pf1/stage.int`, `pf1/team.int` | P1-24, P1-13, P1-36, M-C2 |
| HUB-BR-24 / BR-21 | PF1, PF2 | `pf1/start.int`, `pf2/forward.int` ⇢PF1 | P1-13, P2-04 |
| HUB-BR-25 | PF1–PF4 | `pf{1..4}/isolation.int`, `step0/rls.int`, `step0/rules/run-access` | M-* (int §6), S0-02…S0-06, R-A*; E-P20 |
| HUB-BR-26 | PF1, PF3 | `pf1/gates.int`, `pf1/view.int`, `pf3/inbox.int` | P1-43, P1-51, P1-52, P1-73, P3-04, P3-12, R-S19, R-TK01…R-TK03 |
| HUB-BR-27 | PF1 | `pf1/stage.int` | P1-23, P1-24 |
| HUB-BR-28 | 0, PF1 | `step0/rules/bang`, `step0/flag.int`, `pf1/start.int` | R-B*, S0-10…S0-12, P1-02, P1-03 |
| AC-H28 | PF1 | `pf1/start.int`, `stage.int`, `gates.int`; e2e `pf1/gate` | P1-01, P1-20, P1-40…P1-43; E-P4 |
| AC-H29 | PF1, PF3 | `pf1/isolation.int`, `pf3/inbox.int`, `pf3/outside.int`; e2e `pf3/outside` | M-*, P3-08, P3-10; E-P13, E-P18 |
| AC-H30 | PF1, PF2 | `pf1/ask-open.int`, `pf2/ask.int`, `forward.int`; e2e `pf2/ask` | P1-37, P1-38, P2-02…P2-09; E-P8–E-P10 |
| AC-H31 | PF1 | `pf1/real-action.int` | P1-60…P1-62 |
| AC-H32 | PF1, PF3 | `pf1/team.int`, `view.int`, `pf3/inbox.int` | P1-32, P1-73, P3-04 |
| AC-H33 | PF1 | `pf1/stage.int` | P1-23, P1-24 |
| AC-H34 (vế run) | PF4 | `pf4/usage.int`; e2e `pf4/token` | P4-01…P4-03; E-P14, E-P14b |
| AC-H35 | — | P-b (P-a chỉ phần chạy nhóm: P1-30/31) | — |
| CHAT-AC-51 | PF1 | e2e `pf1/composer` | E-P1, E-P2 |
| CHAT-AC-52 (thread, U1·F4) | 0, PF1 | e2e `pf1/composer`, `pf1/run-thread`; int P1-01, P1-05, P1-80…P1-89, S0-14…S0-19 | E-P2, E-P3, E-P6, E-P17, E-P19, E-P20 |
| CHAT-AC-53 | PF1 | e2e `pf1/gate` (trong thread) | E-P4, E-P5, E-P7 |
| CHAT-AC-54 | PF3 | e2e `pf3/inbox` | E-P11 |
| CHAT-AC-55 | PF3 | e2e `pf3/dm` ⇢PF1 | E-P12 |
| CHAT-AC-56 | PF3, PF4 | e2e `pf3/outside`, `pf4/token` | E-P13, E-P18, E-P14b |
| CHAT-AC-57 | PF2 | e2e `pf2/ask`; int P2-12, P2-16 | E-P8–E-P10 |
| CHAT-AC-58 | PF4, PF1 | e2e `pf4/token`, `pf1/gate` (3 lựa chọn) | E-P14, E-P14b, E-P7 |
| ADM-FR-65 (trừ Import/Export — P-b, U2) | 0, PF4 | `step0/defs.int`; e2e `pf4/admin-processes` | S0-20…S0-24; E-P15a |
| ADM-FR-66 (tối thiểu) | 0, PF4 | `step0/defs.int`, `step0/rules/def`; e2e `pf4/admin-editor` | S0-25…S0-29, R-DF*; E-P15b |
| ADM-FR-67 | PF1, PF4 | `pf1/start.int` (P1-11/12), `pf4/usage.int` (P4-05); e2e `pf4/admin-runs` | E-P15c |
| Cờ `HUB_PROCESS_ENGINE` (D15) | 0 | `step0/flag.int`; e2e `step0/flag-off` | S0-10, S0-11; E-P16 |
| Thứ tự khoá (plan §10, plan-thread §3) | 0, PF1, PF2 | `step0/thread-poster.int`, `pf1/lock-order.int`, `pf2/lock-order.int` | S0-17, P1-48, P1-82, P2-14 |
| `TaskDetail`/`can_act` dùng chung (readiness #2–#3) | 0, PF1, PF3 | `step0/rules/task`, `pf1/view.int`, `pf3/inbox.int` | R-TK*, P1-51, P1-52, P1-76, P3-01 |
| Không ở P-a | — | Import/Export JSON (ADM-FR-65, HUB-FR-104 vế) ⇒ P-b Pb1 (U2) | — |

## 4. Luật thuần (chữ ký plan-contract §7) — `tests/acceptance/P-a/<nhóm>/rules/*.test.ts`
| Mã | Hàm | Nhóm/file | Dữ liệu | Kỳ vọng |
|---|---|---|---|---|
| R-B01 | `classifyBang` | step0/`bang` | `""`, `"xin chào"`, `"abc !hoa-don"`, `"/dich"`, `"@hoadon x"` | `none` |
| R-B02 | ″ | ″ | `"!hoa-don HD-12 tháng 9"` | `{process, key:"hoa-don", input:"HD-12 tháng 9"}` |
| R-B03 | ″ | ″ | `"   !hoa-don"`; `"!HOA-DON  x  "` | input `""`; key chữ thường, input `"x"` (trim) |
| R-B04 | ″ | ″ | `"!!hello"`, `"!!"` | `{escaped, content:"!hello"}`, `{escaped, content:"!"}` (M2) |
| R-B05 | ″ | ″ | `"!"`, `"!a x"`, `"!"+"a"×33`, `"!hoa_don"`, `"!hoá"` | `invalid` (token đúng chuỗi sau `!`) |
| R-B06 | ″ | ″ | `"!hoa-don dòng1\ndòng2"` | input giữ xuống dòng giữa |
| R-S01 | `transition` | step0/`process-state` | running, stage after=review, `stage_output{templateOk:true}` | waiting_review, effects `[open_review]` |
| R-S02 | ″ | ″ | after=auto, chưa stage cuối | running, stageIdx+1, `[queue_next_stage]` |
| R-S03 | ″ | ″ | after=auto, stage cuối | done, `[finish_run]` |
| R-S04 | ″ | ″ | `templateOk:false`, attempt 1 < limit 4 | running cùng stage, attempt 2, `[queue_stage]` (M3) |
| R-S05 | ″ | ″ | `templateOk:false`, attempt = limit | needs_decision `template_invalid`, `[open_decision]` |
| R-S06 | ″ | ″ | `need_input`, asksCount 0..2 | waiting_answer, asksCount+1, attempt **không đổi**, `[open_ask]` |
| R-S07 | ″ | ″ | `need_input`, asksCount 3 | needs_decision `ask_limit` |
| R-S08 | ″ | ″ | waiting_review + `review pass` (giữa / cuối) | running idx+1 `[close_open_tasks, queue_next_stage]` / done |
| R-S09 | ″ | ″ | `review fail`, attempt 1..3 | running attempt+1 `[queue_stage]` |
| R-S10 | ″ | ″ | `review fail`, attempt 4 = limit | needs_decision `redo_limit` (lần làm lại thứ 4, AC-H28) |
| R-S11 | ″ | ″ | waiting_answer + `answer` | running, `[queue_stage]`, attempt giữ |
| R-S12 | ″ | ″ | `decide add_attempt` lý do redo_limit / ask_limit / team_calls | attemptLimit+1 / askLimit+1 / attempt+1; running `[queue_stage]` |
| R-S13 | ″ | ″ | `decide use_current`, hasOutput false | `{ok:false, code:"NO_OUTPUT"}` |
| R-S14 | ″ | ″ | use_current: lý do ≠ redo_limit & after=review / lý do redo_limit / after=auto | waiting_review `[open_review]` / như pass / như stage done |
| R-S15 | ″ | ″ | `decide cancel`; `cancel` từ 4 trạng thái active | cancelled `[cancel_stage_run, close_open_tasks, finish_run]` |
| R-S16 | ″ | ″ | `expire` từ 4 trạng thái active | expired, `close_open_tasks`; **không** stage done/pass |
| R-S17 | ″ | ″ | `limit{reason}` × 10 lý do `DECISION_REASONS` (trừ permission/inactive/interrupted) | needs_decision, decisionReason = reason |
| R-S18 | ″ | ″ | `permission_lost`, `user_inactive`, `interrupted` | needs_decision cùng tên |
| R-S19 | ″ | ″ | mọi sự kiện × {done,cancelled,failed,expired}; `review` khi running; `answer` khi waiting_review; `decide` khi ≠ needs_decision | `PROCESS_RUN_STATE` |
| R-S20 | `isTerminal` | ″ | 8 trạng thái | true đúng 4 trạng thái kết thúc |
| R-A01 | `runAccess` | step0/`run-access` | starter còn ở R (hoặc run không phòng); thành viên phòng active; tenant_admin cùng tenant; platform_admin | `full` |
| R-A02 | ″ | ″ | assignee không ở phòng | `task`; assignee + thành viên ⇒ `full` |
| R-A03 | ″ | ″ | user khác cùng tenant; rời phòng (active=false, không assignee); `r=null` | `null` |
| R-A04 | ″ | ″ | tenant_admin / starter-id tenant khác (tenantId lệch) | `null` |
| R-A05 | `canCancel` | ″ | starter, tenant_admin, platform_admin; starter đã rời R (`originRoom:"outside"`, U5) / thành viên phòng, assignee, admin tenant khác | true; true / false |
| R-A06 | `canDecide` | ″ | starter, tenant_admin × mọi lý do; starter `outside` × mọi lý do; reviewGroupMember × `redo_limit` / × lý do khác; thành viên phòng | true; true (M5, U5: starter đã rời R); true / false; false (M5) |
| R-A07 | `canRun` | ″ | inactive; enabled false; deleted; runGroupIds rỗng; user ∈ / ∉ group | false; false; false; true; true / false (M1) |
| R-A08 | `runAccess` | ″ | starter đã rời R (U5), không assignee | `task` (không `full`, không `null`; plan-contract:116 U5) |
| R-A09 | `canReadThread` | ″ | thành viên phòng (`originRoom:"member"`); starter đã rời R (`outside`); assignee ngoài phòng; tenant_admin / platform_admin không là thành viên | true; false; false; false (RLS phòng, chỉ `member` ⇒ true) |
| R-L01 | `teamLimitHit` | step0/`limits` | calls 9/10; tokens 199 999/200 000; activeMs 599 999/600 000 (`TEAM_LIMITS_DEFAULT`) | null / `calls`; null / `tokens`; null / `time` |
| R-L02 | ″ | ″ | vượt cả 3 | `calls` (thứ tự calls → tokens → time — Câu hỏi Q6) |
| R-L03 | `budgetHit` | ″ | (5e6, null); (999, 1000); (1000, 1000) | false; false; true (C1) |
| R-L04 | `totalTokens` | ″ | cache null; cache có | in+out; in+out+cr+cw (D9) |
| R-K01 | contract | step0/`contracts-pa` | hằng §1 | đúng giá trị (REDO_MAX 3, ASKS_MAX 3, FORWARD_CHAIN_MAX 3, PROCESS_RUNS_PER_TENANT 5, TTL 7, REMIND 24, TEAM_LIMITS_DEFAULT, mảng trạng thái đúng thứ tự) |
| R-K02 | ″ | ″ | `CHAT_PROCESS_ERRORS`, `HUB_ADMIN_PROCESS_ERRORS` | đúng 12 (gồm `PROCESS_THREAD_NO_AGENT` 422) / 5 mã + HTTP |
| R-K03 | ″ | ″ | khối X2a/X2b/C1 (`CHAT_API_ERRORS`, `CHAT_ROUTING_ERRORS`, `CHAT_ROOM_*`, `ME_STREAM_*`, `ROOM_KINDS`) | số lượng giữ nguyên (**xanh trước code**); `ROOM_SENDER_TYPES` = `["user","agent","process"]` (chỉ nối thêm, T3) |
| R-K04 | ″ | ″ | `ProcessRunView` access `task` thêm `input`/`history`/`decision` | parse **fail** (strict ⇒ không rò) |
| R-K05 | ″ | ″ | `ProcessNotice` thêm `content`/`output` | fail |
| R-K06 | ″ | ″ | `parseMeStreamProcessEvent` 4 sự kiện; tên lạ; khoá thừa | parse; null; null |
| R-K07 | ″ | ″ | `RoomMessage` cũ / có `process_run_id` | cả hai parse |
| R-K09 | ″ | ″ | `RoomProcessPart` 7 kind (`ROOM_PROCESS_KINDS`); `forward` kèm `note`; kind lạ; `RoomMessage` `sender_type:"process"` + `process` | parse 7; fail (strict); fail; parse |
| R-K10 | ″ | ″ | `TaskDetail` decision có `options`+`has_output`; full có `open_tasks`, `thread:null`; `/me/review-tasks` `open_count` > `OPEN_TASKS_COUNT_MAX` | parse; parse; fail |
| R-K08 | ″ | ″ | body `POST /process-runs` input 8 001; key "Ab"; origin `none`; decision feedback 4 001; forward note 501; `ProcessDefInput` stages 0/11, `real_action` không kèm review | fail / fail / ok / fail / fail / fail (zod) |
| R-TM01 | `checkTemplate` | pf1/`template` | đủ mục `## Bảng ý`… thân không rỗng | ok, missing [] |
| R-TM02 | ″ | ″ | thiếu một heading; heading có thân rỗng; `### Bảng ý` | missing đúng tên |
| R-TM03 | ″ | ″ | `"##   bảng Ý  "` | khớp (không phân biệt hoa thường, trim) |
| R-TM04 | ″ | ″ | khối ```` ```fields {"tong_tien":12000000,"ngay":"2026-10-01"} ```` | fields parse đúng kiểu |
| R-TM05 | ″ | ″ | thiếu trường required; sai kiểu (`"abc"` cho number); JSON hỏng | ok false, `fieldErrors` ≠ [] |
| R-TM06 | ″ | ″ | template không khai báo fields | `fields: null` |
| R-T01 | `parseLeadPlan` | pf1/`team` | JSON hợp lệ 3 bước; `"xin chào"`; `[]`; 6 bước max 5; member lạ | ok / `json` / `empty` / `too_many` / `unknown_member` |
| R-T02 | `assembleSections` | ″ | m1 trả "Phần A" mới; trả y hệt; kèm "Phần B" (không sở hữu) | changed true; changed false; `foreign:["Phần B"]`, Phần B giữ bản cũ |
| R-T03 | `renderDoc` | ″ | map đảo thứ tự | thứ tự theo template |
| R-T04 | `clipSummary` | ″ | 2 000 ký tự, 200 token; 100 ký tự | ≤ 800 ký tự; giữ nguyên |
| R-T05 | `redoMembers` | ″ | sections ["Phần B"]; vắng sections, góp ý nhắc "phần c"; không khớp | [m2]; [m3]; [m1,m2,m3] (D8) |
| R-T06 | `mergeQuestions` | ″ | 2 câu hỏi (m1, m2) | 1 `question` chứa cả hai (kèm vai), choices hợp |
| R-G01 | `realActionAllowed` | pf1/`gate` | null; prev auto done | false; false |
| R-G02 | ″ | ″ | prev review `done`; prev review `waiting_review` | true; false (HUB-FR-109) |
| R-G03 | `reviewDecisionCheck` | ″ | pass; fail vắng; fail `"   "`; fail "Thiếu MST" | ok; FEEDBACK_REQUIRED; FEEDBACK_REQUIRED; ok |
| R-G05 | `suggestProcesses` | ″ | "hoa-dn" / "zzz" với 5 key | ["hoa-don"] (≤ 3) / [] |
| R-AK01 | `forwardCheck` | pf2/`ask` | kind decision; status closed; forwards 3; closed + forwards 3 | TASK_KIND_MISMATCH; REVIEW_TASK_CLOSED; FORWARD_LIMIT; REVIEW_TASK_CLOSED (closed trước) |
| R-AK02 | ″ | ″ | review → người ∉ groupId; review → ∈ group | FORWARD_OUT_OF_GROUP; ok |
| R-AK03 | ″ | ″ | ask → inactive / khác tenant / `to.id = by` / đã assignee / user bất kỳ active cùng tenant | FORWARD_TARGET_INVALID ×4; ok |
| R-N01 | `noticeRecipients` | pf3/`notify` | users [T,B], group [B,X], exclude B | [T,X] không trùng |
| R-N02 | `dueReminder` | ″ | open, remindAt ≤ now, remindedAt null / đã nhắc / closed / remindAt > now | true / false / false / false (chỉ 1 lần) |
| R-U01 | `buildUsage` | pf4/`usage` | 2 stage: stage 0 hai attempt (agent), stage 1 nhóm 3 member + 1 plan | totals = Σ(in+out+cr+cw), calls = số dòng; stage 1 `team_runs[0].calls` 4 (role plan/member, member_key) |
| R-U02 | ″ | ″ | cùng dữ liệu, `summary` | totals như full; `team_runs=[]`, `calls=[]` (C5) |
| R-U03 | ″ | ″ | stage không có dòng; cache null | totals 0; cache tính 0 |
| R-U04 | ″ | ″ | 60 dòng một stage | `calls` ≤ 50, totals đủ 60 (Câu hỏi Q4) |
| R-TK01 | `canAct` | step0/`task` | review open: A ∈ userIds; B ∈ groupIds∋groupId; X ngoài cả hai; người đã chuyển (vẫn trong userIds) | true; true; false; true |
| R-TK02 | ″ | ″ | task closed; run `cancelled`/`done`/`expired`; viewer tenant khác (member, tenant_admin) / platform_admin, task open | false; false; false / true |
| R-TK03 | ″ | ″ | decision `redo_limit`: starter, tenant_admin, B (groupIds∋reviewGroupId), X; decision `team_calls`: B | true, true, true, false; false (M5 qua `canDecide`) |
| R-TK04 | `askExcerpt` (cũ R-AK04, chuyển B0) | ″ | input 1 500 ký tự; 20 ký tự; max 50; ký tự nhiều byte ở mốc 1 000 | 1 000 ký tự đầu; nguyên; 50; không cắt đôi ký tự (C4) |
| R-TK05 | `decisionAssignees` | ″ | `redo_limit` + G; `redo_limit` + null; `team_calls`/`ask_limit`/`permission_lost` + G | `{userIds:[A], groupId:G}`; `{[A], null}`; `{[A], null}` (không tenant_admin) |
| R-TK06 | `threadContent` | step0/`thread` | 7 kind × vi/en; `task_result` feedback 3 000 ký tự | chuỗi 1..500 (cắt ≤ 500); `forward` không có note (kiểu không có trường) |
| R-DF01 | `validateProcessDef` | step0/`def` | key stage trùng; `real_action` ở stage 0; stage trước `auto` | `PROCESS_DEF_INVALID`, paths `stages.<i>.<trường>` |
| R-DF02 | ″ | ″ | agent lạ stage 2 + team lạ stage 3; group lạ; user lạ | `PROCESS_REF_INVALID` path stage 2 ref `agent` (stage lỗi đầu); `group`; `user` |
| R-DF03 | ″ | ″ | bật + review thiếu `group_id`; INVALID và INCOMPLETE cùng lúc | `PROCESS_DEF_INCOMPLETE{paths:["stages.0.after.group_id"]}`; INVALID (thứ tự) |
| R-DF04 | `copyFromTemplate` | ″ | mẫu có group; `{key:"sdlc-2"}` | mọi `after.group_id=null`, `enabled=false`; key/tên theo `o` |

## 5. Đỏ đúng lý do (QC1 — chạy trước B1 trên `ai_system_qc_test`)
| Nhóm | Chỗ đỏ mong đợi | Cấm đỏ ở |
|---|---|---|
| rules/* | `expect(typeof mod.fn).toBe("function")` qua `_modules.ts` (module vắng ⇒ `{}`) | `import` lỗi (không import tĩnh file chưa có) |
| contracts-pa | `expect(export).toBeDefined()`; R-K03 xanh trước code (ghi rõ) | lỗi typecheck (dùng `import * as C` + truy cập động) |
| step0 int (rls/defs/seed/flag) | ca đầu `expect(await hasPaSchema(sql)).toBe(true)`; route 404 ≠ kỳ vọng | `PostgresError` ở `beforeAll` — fixture chỉ chèn bảng mới **sau** `hasPaSchema` (vắng ⇒ bỏ chèn, ca đỏ ở expect schema) |
| step0 thread (S0-08/09, S0-14…19) | `hasPaSchema`; `postThreadOnce` vắng trong handles (`onProcessHandles` không gọi) ⇒ `expect(h?.postThreadOnce).toBeDefined()`; 201≠422 (T7 chưa có) | chèn `process_thread_events` khi bảng vắng (fixture sau `hasPaSchema`) |
| pf1–pf4 int | `hasPaSchema` / `201≠404` (route chưa mount) / header `X-Process-Run-Id` null | `TypeError` khi đọc body lỗi (dùng `res.json().catch(()=>null)`) |
| e2e | `expect(locator).toBeVisible()` (nút "Quy trình", thẻ run…) | stack không lên — `_pa-stack` chạy migrate tới 0018 khi 0019 vắng; cờ bật vô hại |
Kết quả ghi bảng "File · Tổng · Đỏ đúng lý do · Xanh trước code (chủ ý) · Chỗ đỏ" vào mục này trước `test:lock:write`. Ca xanh trước code chủ ý: R-K03, S0-10 (cờ off = hành vi cũ), S0-12b (`/conversations` hiện tại không lộ), M-room (404 phòng cho T — hồi quy X2a), E-P16 phần "test khoá cũ".

**QC1a — Bước 0 (2026-10-10, `ai_system_pa_qc_test` / `.env.test-pa_qc.local`, Redis 10, trước B1):**
| File `P-a/step0/` | Tổng | Đỏ đúng | Xanh chủ ý | Chỗ đỏ |
|---|---|---|---|---|
| `rules/*` (7 file luật) | 49 | 49 | 0 | `fn()` ⇒ expect hàm |
| `rules/contracts-pa` (R-K03 tách 2 `it`) | 11 | 10 | 1 R-K03 | export vắng / parse |
| `migration` · `rls` · `flag` | 1 · 8 · 4 | 12 | 1 S0-10 | file 0019 / `needSchema` |
| `thread-route` · `thread-poster` · `thread-read` (+S0-19) | 4 · 3 · 3 | 10 | 0 | `needSchema` |
| `defs` · `seed` | 12 · 2 | 14 | 0 | `needSchema` |
| **Tổng** | **97** | **95** | **2** | 0 lỗi fixture |
Helper ở `P-a/_support/` (thay `_pa.ts`…). S0-15 "post ∥ postThreadOnce" = 2 `postThreadOnce` song song. Phần Hỏi AI của S0-10/11 do H1/X2b phủ.

## 6. `done:pa` (`tools/scripts/src/done-pa.ts`, mẫu `done-x2b.ts`; `--skip=int,e2e`)
| # | Lệnh | Chặn |
|---|---|---|
| 1 | `bun run check` · `bun run typecheck` | có |
| 2 | `bun test packages/contracts` · `bun test tests/acceptance/P-a --path-ignore '*.int.test.ts'` (rules) | có |
| 3 | `bun --env-file=.env.local --config=bunfig.int.toml test --timeout 40000 tests/acceptance/P-a/step0 …/pf1 …/pf2 …/pf3 …/pf4 …/scenario` | có |
| 4 | int khoá cũ, cờ **off** và **on**: `tests/acceptance/{H1,H2b,C1,X2a,X2b}` (`HUB_PROCESS_ENGINE=off`, rồi `=on`) | có |
| 5 | int backend-lead: `lock-order` (P1-48, P2-14) + migration 0019 chạy 2 lần (S0-01) | có |
| 6 | `bunx playwright test -c e2e/P-a/playwright.pa.config.ts --reporter=line` (step0, pf1–pf4, scenario) | có |
| 7 | e2e khoá cũ: `e2e:chat:x2a`, `e2e:chat:x2b` (cờ off) | có |
| 8 | `bun run test:lock:verify` · `bun run trace --check` (mọi mã §3 có test) | có |
| 9 | `test:perf` P-a (plan §11) | **không** (ưu tiên thấp) |

## 7. Cần bổ sung / yêu cầu (Luật 2: mặc định qc, không chặn Gate)
- backend-lead (B2): tên schema — body `POST /process-runs` ∈ {`CreateProcessRunRequestSchema`, `StartProcessRunRequestSchema`, `ProcessRunCreateRequestSchema`}; decision ∈ {`ReviewDecisionRequestSchema`, `ReviewTaskDecisionRequestSchema`}; forward ∈ {`ForwardReviewTaskRequestSchema`, `ReviewTaskForwardRequestSchema`, `ForwardTaskRequestSchema`}; `/me/review-tasks` ∈ {`ReviewTaskListResponseSchema`, `MeReviewTasksResponseSchema`, `ReviewTasksResponseSchema`}; `ProcessRunViewSchema`, `ProcessNoticeSchema`, `TaskDetailSchema`, `RoomProcessPartSchema`, `ProcessDefInputSchema` (hub-admin). Đặt tên khác ⇒ báo qc (QC1a).
Đã đóng ở vòng 2: N1 (`validateProcessDef`/`copyFromTemplate` ⇒ R-DF*), N2 (PF1 mở ask, plan-step0 §1 ⇒ P1-37…39), N3 (§7.1 seam: `processEngine`, `processRunsPerTenant`, `stageLauncher`, `now`, `processLoops:false`, `onProcessHandles` ⇒ test gọi `sweepOnce`/`remindOnce`/`postThreadOnce`/`kick`, mốc thời gian bằng `now` giả, không lùi SQL trừ ca ghi rõ), N4 (§7.1: 1 `hub.runs`/lần thử, `run_steps` mỗi lần gọi, payload không thêm khoá ⇒ runtime giả ghi `usage_logs.step_id`), N5/N6 (plan-step0 §3: `PA_FIX`, `POST /__mock/process`, `GET /__mock/calls`), N10 (R2-7: giữ `Promise<number>`, qc đếm `process_thread_events.outcome` bằng SQL).
| # | Gửi | Việc | Mặc định qc |
|---|---|---|---|
| N7 | frontend-lead | Nhãn plan-frontend-e2e §1–§2; `data-testid="process-total-tokens"` (KPI Tổng token); `data-run-id` ở khối quy trình; cổng e2e từ `PA_E2E_PORT_BASE` | role + text |
| N9 | frontend-lead | Đưa nhãn thread (plan-frontend-thread §1–§5, i18n-thread) vào bảng plan-frontend-e2e §1 + sửa E-P3/E-P4 §3 (còn ghi "không thread", pane `?run=`) | test-plan-e2e dùng nhãn plan-frontend-thread/i18n-thread (đã ghi) |
| N11 | docs-architect | C2 ngoại lệ HUB-BR-23 đã ghi BA (spec C2) — qc trỏ P1-36 | — |

## 8. Câu hỏi qc — đã chốt (spec §9 "Mặc định áp dụng" 2026-10-10)
| # | Quyết định |
|---|---|
| Q1 | `scenario/` chỉ chạy ở cổng merge **PF4** + `done:pa` (sửa readiness #5) |
| Q2 | T ngoài phòng thuộc Group duyệt được `decide` khi `redo_limit` (U4·M5) |
| Q3 | Người xem `task` gọi `cancel`/`decide` không đủ quyền ⇒ 403 `NOT_PROCESS_DECIDER` |
| Q4 | `usage` stage > 50 lần gọi: cắt danh sách, `totals` đủ |
| Q5 | Quota người bắt đầu hết giữa run ⇒ needs_decision `agent_failed` |
| Q6 | `teamLimitHit` nhiều giới hạn ⇒ calls → tokens → time |
| Q7 | `answerer = group` ⇒ mọi thành viên là assignee; trả lời đầu thắng |

## 9. Số ca (vòng 2; mỗi mã = ≥ 1 `it`)
| Nhóm | rules | int | e2e | Tổng | Ghi chú |
|---|---|---|---|---|---|
| Bước 0 | 58 (B 6 · S 20 · A 8 · L 4 · K 10 · TK 6 · DF 4) | 33 (S0-01…S0-33, gồm thread S0-08/09, S0-14…19) | 1 | 92 | luôn chạy |
| PF1 | 16 (TM 6 · T 6 · G 4) | 69 (P1-01…P1-89; thread P1-80…89; C2 P1-36; ask P1-37…39) | 10 (+E-P19, E-P20) | 95 | |
| PF2 | 3 (AK) | 14 (P2-02…P2-16; ⇢PF1: P2-04 phần job, P2-11) | 3 | 20 | P2-01/P2-10 ⇒ P1-37/P1-38 |
| PF3 | 2 (N) | 12 (P3-01…P3-12; ⇢PF1: P3-07, P3-08, P3-10, P3-12) | 4 (⇢PF1: E-P12, E-P18) | 18 | |
| PF4 | 4 (U) | 7 (⇢PF1: P4-07) | 5 (⇢PF1: E-P15c) | 16 | E-P14b nhận phần Token từ E-P13 |
| Ma trận `M-*` | — | 132 ô (11 vai, + A' U5) + 8 ca phụ (`M-audit`, `M-M4`, `M-body`, `M-404-same`, `M-thread-insert`, `M-thread-events`, `M-thread-agent`, `M-C2`) | — | 140 | chia pf theo cột (int §6) |
| Kịch bản | — | 2 | 2 | 4 | chỉ cổng merge PF4 + `done:pa` |

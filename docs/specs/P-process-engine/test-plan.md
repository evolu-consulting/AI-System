# Test plan · P-process-engine · P-a (qc, chế độ WRITE/PLAN — chưa viết test, chưa LOCK)

Nguồn: spec §2, §2.1, §8, §9 (M1–M6, C1–C5, F1–F4) · plan §3–§5, §8–§10 · plan-contract §1–§9 · plan-seed D18 · plan-frontend-e2e §1–§3 · BA-H §6.10 (HUB-FR-104…117, HUB-BR-23…28), §11 AC-H28…H34 · usecases-chat CHAT-AC-51…58 · ba-admin ADM-FR-65…67. Phụ lục: [`test-plan-int.md`](test-plan-int.md) (ca int từng PF + ma trận cách ly + kịch bản seed) · [`test-plan-e2e.md`](test-plan-e2e.md) (e2e chat-web + admin-web). Test viết ở **QC1** (sau Gate); runtime = runtime giả claim `hub.jobs` (mẫu `H1/_runtime.ts`, `X2b/_x2b.ts runtimeUsage`), provider `fake-cli`, không Dify thật / `claude-sub`.

## 1. Bố cục theo feature (CR-059) + lệnh chạy
| Nhóm | Thư mục int/luật | Thư mục e2e | Phụ thuộc code | Nhánh chạy |
|---|---|---|---|---|
| **Bước 0** (B1, B2, B0, B3) | `tests/acceptance/P-a/step0/{rules,*.int.test.ts}` | `e2e/P-a/step0/` (E-P16 cờ off) | 0019, contract, khung, defs/seed | mọi nhánh (luôn chạy) |
| **PF1** chạy + cổng kiểm | `tests/acceptance/P-a/pf1/…` | `e2e/P-a/pf1/` | Bước 0 | `feat/pa-pf1-run-gate` |
| **PF2** hỏi lại + nhờ trả lời | `tests/acceptance/P-a/pf2/…` | `e2e/P-a/pf2/` | Bước 0 (fixture SQL `waiting_answer`, `kick` giả); ca đánh dấu **⇢PF1** cần PF1 trên `main` | `feat/pa-pf2-ask` |
| **PF3** ngoài phòng + báo việc | `tests/acceptance/P-a/pf3/…` | `e2e/P-a/pf3/` | Bước 0 (fixture SQL `review_tasks`); ca **⇢PF1** cần `GET /process-runs/:id` | `feat/pa-pf3-outside` |
| **PF4** token + Evolu Control | `tests/acceptance/P-a/pf4/…` | `e2e/P-a/pf4/` (chat + admin) | Bước 0 (fixture SQL usage); e2e admin "Chạy" **⇢PF1** | `feat/pa-pf4-usage-admin` |
| **Kịch bản** (liên PF) | `tests/acceptance/P-a/scenario/` | `e2e/P-a/scenario/` | PF1+PF2+PF3 trên `main` | chỉ `main` (cổng merge PF2 trở đi + `done:pa`) |

- Nhánh PF*n*: `bun test tests/acceptance/P-a/{step0,pf<n>}/**/rules` + `test:int` trên `tests/acceptance/P-a/{step0,pf<n>}` + `bunx playwright test -c e2e/P-a/playwright.pa.config.ts --project=step0 --project=pf<n>`. Ca **⇢PFk** đỏ trên nhánh cho tới khi PFk vào `main` (thứ tự merge PF1 → PF3 → PF2 → PF4 bảo đảm xanh lúc merge); chủ nhánh không coi là hồi quy.
- Cổng merge / `done:pa`: toàn bộ `tests/acceptance/P-a/**` + `e2e/P-a/**` + test khoá cũ (H1, H2b, C1, X2a, X2b — cờ off **và** on).
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
| HUB-FR-104 (tối thiểu) | 0 | `step0/defs.int`, `step0/seed.int` | S0-20…S0-33 |
| HUB-FR-105 | PF1 | `pf1/start.int`; `pf1/rules/gate` | P1-01…P1-14, R-G05–06 |
| HUB-FR-106 | PF1 | `pf1/stage.int`, `pf1/rules/template` | P1-20…P1-29, R-TM* |
| HUB-FR-107 | PF1 | `pf1/gates.int`, `pf1/rules/gate` | P1-40…P1-50, R-G03–04 |
| HUB-FR-109 | PF1 | `pf1/real-action.int`, `pf1/rules/gate` | P1-60…P1-62, R-G01–02 |
| HUB-FR-110 | PF2 | `pf2/ask.int`, `pf1/rules/team` (mergeQuestions) | P2-01, P2-02, P2-10, P2-11 |
| HUB-FR-111 | PF2 | `pf2/forward.int`, `pf2/rules/ask` | P2-03…P2-09, P2-12…P2-15, R-AK* |
| HUB-FR-112 | PF3 | `pf3/inbox.int`, `pf3/rules/notify` | P3-01…P3-09, R-N* |
| HUB-FR-113 | PF1 | `pf1/view.int`, `pf1/isolation.int` | P1-70…P1-75, M-* |
| HUB-FR-114 (nhóm seed) | PF1 | `pf1/team.int`, `pf1/rules/team` | P1-30, P1-31, P1-33, P1-34, R-T* |
| HUB-FR-115 | PF1 | `pf1/team.int`, `pf1/stage.int`, `step0/rules/limits` | P1-25, P1-26, P1-28, P1-32, R-L* |
| HUB-FR-116 | PF1 | `pf1/stage.int` | P1-27 |
| HUB-FR-117 (vế run) | PF4 | `pf4/usage.int`, `pf4/rules/usage` | P4-01…P4-07, R-U* |
| HUB-BR-23 | PF1 | `pf1/stage.int` | P1-24, P1-13 |
| HUB-BR-24 / BR-21 | PF1, PF2 | `pf1/start.int`, `pf2/forward.int` ⇢PF1 | P1-13, P2-04 |
| HUB-BR-25 | PF1–PF4 | `pf{1..4}/isolation.int`, `step0/rls.int`, `step0/rules/run-access` | M-* (int §6), S0-02…S0-06, R-A* |
| HUB-BR-26 | PF1, PF3 | `pf1/gates.int`, `pf1/view.int`, `pf3/inbox.int` | P1-43, P1-73, P3-04, R-S19 |
| HUB-BR-27 | PF1 | `pf1/stage.int` | P1-23, P1-24 |
| HUB-BR-28 | 0, PF1 | `step0/rules/bang`, `step0/flag.int`, `pf1/start.int` | R-B*, S0-10…S0-12, P1-02, P1-03 |
| AC-H28 | PF1 | `pf1/start.int`, `stage.int`, `gates.int`; e2e `pf1/gate` | P1-01, P1-20, P1-40…P1-43; E-P4 |
| AC-H29 | PF1, PF3 | `pf1/isolation.int`, `pf3/inbox.int`; e2e `pf3/outside` | M-*, P3-08; E-P13 |
| AC-H30 | PF2 | `pf2/ask.int`, `forward.int`; e2e `pf2/ask` | P2-01…P2-10; E-P8–E-P10 |
| AC-H31 | PF1 | `pf1/real-action.int` | P1-60…P1-62 |
| AC-H32 | PF1, PF3 | `pf1/team.int`, `view.int`, `pf3/inbox.int` | P1-32, P1-73, P3-04 |
| AC-H33 | PF1 | `pf1/stage.int` | P1-23, P1-24 |
| AC-H34 (vế run) | PF4 | `pf4/usage.int`; e2e `pf4/token` | P4-01…P4-03; E-P14 |
| AC-H35 | — | P-b (P-a chỉ phần chạy nhóm: P1-30/31) | — |
| CHAT-AC-51 | PF1 | e2e `pf1/composer` | E-P1, E-P2 |
| CHAT-AC-52 | PF1 | e2e `pf1/composer`, `pf1/run-card`; int P1-01, P1-05 | E-P2, E-P3, E-P6 |
| CHAT-AC-53 | PF1 | e2e `pf1/gate` | E-P4, E-P5, E-P7 |
| CHAT-AC-54 | PF3 | e2e `pf3/inbox` | E-P11 |
| CHAT-AC-55 | PF3 | e2e `pf3/dm` | E-P12 |
| CHAT-AC-56 | PF3 | e2e `pf3/outside` | E-P13 |
| CHAT-AC-57 | PF2 | e2e `pf2/ask`; int P2-12 | E-P8–E-P10 |
| CHAT-AC-58 | PF4, PF1 | e2e `pf4/token`, `pf1/gate` (3 lựa chọn) | E-P14, E-P7 |
| ADM-FR-65 | 0, PF4 | `step0/defs.int`; e2e `pf4/admin-processes` | S0-20…S0-24; E-P15a |
| ADM-FR-66 (tối thiểu) | 0, PF4 | `step0/defs.int`; e2e `pf4/admin-editor` | S0-25…S0-29; E-P15b |
| ADM-FR-67 | PF1, PF4 | `pf1/start.int` (P1-11/12), `pf4/usage.int` (P4-05); e2e `pf4/admin-runs` | E-P15c |
| Cờ `HUB_PROCESS_ENGINE` (D15) | 0 | `step0/flag.int`; e2e `step0/flag-off` | S0-10, S0-11; E-P16 |
| Thứ tự khoá (plan §10) | PF1, PF2 | `pf1/lock-order.int`, `pf2/lock-order.int` | P1-48, P2-14 |

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
| R-A01 | `runAccess` | step0/`run-access` | starter; thành viên phòng active; tenant_admin cùng tenant; platform_admin | `full` |
| R-A02 | ″ | ″ | assignee không ở phòng | `task`; assignee + thành viên ⇒ `full` |
| R-A03 | ″ | ″ | user khác cùng tenant; rời phòng (active=false, không assignee); `r=null` | `null` |
| R-A04 | ″ | ″ | tenant_admin / starter-id tenant khác (tenantId lệch) | `null` |
| R-A05 | `canCancel` | ″ | starter, tenant_admin, platform_admin / thành viên phòng, assignee, admin tenant khác | true / false |
| R-A06 | `canDecide` | ″ | starter, tenant_admin × mọi lý do; reviewGroupMember × `redo_limit` / × lý do khác; thành viên phòng | true; true / false; false (M5) |
| R-A07 | `canRun` | ″ | inactive; enabled false; deleted; runGroupIds rỗng; user ∈ / ∉ group | false; false; false; true; true / false (M1) |
| R-L01 | `teamLimitHit` | step0/`limits` | calls 9/10; tokens 199 999/200 000; activeMs 599 999/600 000 (`TEAM_LIMITS_DEFAULT`) | null / `calls`; null / `tokens`; null / `time` |
| R-L02 | ″ | ″ | vượt cả 3 | `calls` (thứ tự calls → tokens → time — Câu hỏi Q6) |
| R-L03 | `budgetHit` | ″ | (5e6, null); (999, 1000); (1000, 1000) | false; false; true (C1) |
| R-L04 | `totalTokens` | ″ | cache null; cache có | in+out; in+out+cr+cw (D9) |
| R-K01 | contract | step0/`contracts-pa` | hằng §1 | đúng giá trị (REDO_MAX 3, ASKS_MAX 3, FORWARD_CHAIN_MAX 3, PROCESS_RUNS_PER_TENANT 5, TTL 7, REMIND 24, TEAM_LIMITS_DEFAULT, mảng trạng thái đúng thứ tự) |
| R-K02 | ″ | ″ | `CHAT_PROCESS_ERRORS`, `HUB_ADMIN_PROCESS_ERRORS` | đúng 11 / 5 mã + HTTP |
| R-K03 | ″ | ″ | khối X2a/X2b/C1 (`CHAT_API_ERRORS`, `CHAT_ROUTING_ERRORS`, `CHAT_ROOM_*`, `ME_STREAM_*`, `ROOM_KINDS`, `ROOM_SENDER_TYPES`) | số lượng giữ nguyên (**xanh trước code**, bảo toàn) |
| R-K04 | ″ | ″ | `ProcessRunView` access `task` thêm `input`/`history`/`decision` | parse **fail** (strict ⇒ không rò) |
| R-K05 | ″ | ″ | `ProcessNotice` thêm `content`/`output` | fail |
| R-K06 | ″ | ″ | `parseMeStreamProcessEvent` 4 sự kiện; tên lạ; khoá thừa | parse; null; null |
| R-K07 | ″ | ″ | `RoomMessage` cũ / có `process_run_id` | cả hai parse |
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
| R-AK04 | `askExcerpt` | ″ | input 1 500 ký tự; 20 ký tự; max 50 | 1 000 ký tự đầu; nguyên; 50 (C4) |
| R-N01 | `noticeRecipients` | pf3/`notify` | users [T,B], group [B,X], exclude B | [T,X] không trùng |
| R-N02 | `dueReminder` | ″ | open, remindAt ≤ now, remindedAt null / đã nhắc / closed / remindAt > now | true / false / false / false (chỉ 1 lần) |
| R-U01 | `buildUsage` | pf4/`usage` | 2 stage: stage 0 hai attempt (agent), stage 1 nhóm 3 member + 1 plan | totals = Σ(in+out+cr+cw), calls = số dòng; stage 1 `team_runs[0].calls` 4 (role plan/member, member_key) |
| R-U02 | ″ | ″ | cùng dữ liệu, `summary` | totals như full; `team_runs=[]`, `calls=[]` (C5) |
| R-U03 | ″ | ″ | stage không có dòng; cache null | totals 0; cache tính 0 |
| R-U04 | ″ | ″ | 60 dòng một stage | `calls` ≤ 50, totals đủ 60 (Câu hỏi Q4) |
`def.rules.ts` (B3) chưa có chữ ký ở §7 ⇒ kiểm qua API (S0-25…S0-29); xem §7 "Cần bổ sung".

## 5. Đỏ đúng lý do (QC1 — chạy trước B1 trên `ai_system_qc_test`)
| Nhóm | Chỗ đỏ mong đợi | Cấm đỏ ở |
|---|---|---|
| rules/* | `expect(typeof mod.fn).toBe("function")` qua `_modules.ts` (module vắng ⇒ `{}`) | `import` lỗi (không import tĩnh file chưa có) |
| contracts-pa | `expect(export).toBeDefined()`; R-K03 xanh trước code (ghi rõ) | lỗi typecheck (dùng `import * as C` + truy cập động) |
| step0 int (rls/defs/seed/flag) | ca đầu `expect(await hasPaSchema(sql)).toBe(true)`; route 404 ≠ kỳ vọng | `PostgresError` ở `beforeAll` — fixture chỉ chèn bảng mới **sau** `hasPaSchema` (vắng ⇒ bỏ chèn, ca đỏ ở expect schema) |
| pf1–pf4 int | `hasPaSchema` / `201≠404` (route chưa mount) / header `X-Process-Run-Id` null | `TypeError` khi đọc body lỗi (dùng `res.json().catch(()=>null)`) |
| e2e | `expect(locator).toBeVisible()` (nút "Quy trình", thẻ run…) | stack không lên — `_pa-stack` chạy migrate tới 0018 khi 0019 vắng; cờ bật vô hại |
Kết quả ghi bảng "File · Tổng · Đỏ đúng lý do · Xanh trước code (chủ ý) · Chỗ đỏ" vào mục này trước `test:lock:write`. Ca xanh trước code chủ ý: R-K03, S0-10 (cờ off = hành vi cũ), S0-12b (`/conversations` hiện tại không lộ), M-room (404 phòng cho T — hồi quy X2a), E-P16 phần "test khoá cũ".

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

## 7. Cần bổ sung / yêu cầu (Luật 2: qc tự chọn mặc định, không chặn Gate)
| # | Gửi | Việc | Mặc định qc dùng nếu không trả lời |
|---|---|---|---|
| N1 | backend-lead (B3) | Chữ ký luật `def.rules.ts` (vd `validateProcessDef(input, refs) → ok \| {code, paths\|path,ref}`) vào plan-contract §7 | Chỉ test qua API (S0-25…S0-29) |
| N2 | backend-lead | Chủ sở hữu "need_input → mở task ask" (plan §4 nói `stage-driver` PF1; tasks B6b nói `asks/**` PF2) | stage-driver (PF1) gọi port asks; ca P2-01/P2-10/P2-11 đánh dấu ⇢PF1 |
| N3 | backend-lead (B0) | Seam `createApp` deps: `processEngine: boolean`, `processRunsPerTenant`, `stageLauncher?` (PF2 thay `kick` giả ghi runId), `sweepOnce()`/`remindOnce()` export gọi trực tiếp (không đợi 30 s/60 s/5 phút), `now?: () => Date` | test lùi mốc thời gian bằng SQL + gọi `sweepOnce` |
| N4 | backend-lead (B0/B5) | Payload job stage có `process_run_id`, `stage_run_id`, `team_run_id`, `step_id`, `files[{name,version}]`, `timeoutS`; Hub ghi `run_steps` cho mỗi lần gọi nhóm (role, member_key, `detail.team_run_id`) | runtime giả ghi `usage_logs.step_id` theo payload (như `runtimeUsage`) |
| N5 | backend-lead (B2) | Mock + fixture `tools/mocks/src/chat/processes/*` id cố định: run ở 6 trạng thái (running · waiting_review có T ngoài phòng · waiting_answer có chuỗi chuyển 2 · needs_decision redo_limit · done có usage 2 stage + nhóm 3 · cancelled), inbox 3 notice, usage full/summary | e2e pf2–pf4 chạy Hub thật + SQL fixture qc |
| N6 | backend-lead | Mock Dify H2a workflow `ghi-so` (`side_effect`) đếm số lần gọi, đọc qua `GET /__mock/calls` | đếm qua `tool_confirmations.consumed_at` + audit |
| N7 | frontend-lead | Giữ nhãn plan-frontend-e2e §1–§2; thêm `data-testid="process-total-tokens"` cho KPI "Tổng token" (so khớp E-P14); `data-run-id` ở thẻ run; ports e2e đọc từ env (`PA_E2E_PORT_BASE`) | dùng role + text |
| N8 | spec-readiness | Xác nhận các câu hỏi §8 | dùng mặc định |

## 8. Câu hỏi (mặc định qc; spec-readiness hỏi một lượt nếu cần)
| # | Câu hỏi | Mặc định |
|---|---|---|
| Q1 | Thư mục `scenario/` (liên PF) chạy chỉ trên `main` từ khi PF1–PF3 đã merge | Có |
| Q2 | T (ngoài phòng, thuộc Group kiểm) được `decide` khi lý do `redo_limit` dù chỉ có access `task` | Có (M5, `canDecide`) |
| Q3 | Người xem `task` gọi `cancel`/`decide` không đủ quyền ⇒ 403 `NOT_PROCESS_DECIDER` (thấy run) chứ không 404 | 403 (contract §3) |
| Q4 | `usage` stage > 50 lần gọi: cắt danh sách, `totals` vẫn đủ | Có |
| Q5 | Quota người bắt đầu hết giữa run (BR-21) ⇒ job lỗi ⇒ needs_decision `agent_failed` (không chạy bằng quota người duyệt) | Có |
| Q6 | `teamLimitHit` chạm nhiều giới hạn cùng lúc ⇒ trả theo thứ tự calls → tokens → time | Có |
| Q7 | `answerer = group` ⇒ mọi thành viên group là assignee; trả lời đầu thắng | Có |

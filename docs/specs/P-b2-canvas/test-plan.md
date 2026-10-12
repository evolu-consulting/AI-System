# Test plan · P-b2-canvas (qc, chế độ PLAN — CHƯA viết code test, CHƯA LOCK; khoá sau readiness lần 2 / T3)

Gate người dùng 2026-10-12 + mặc định readiness: [spec-decisions.md](spec-decisions.md). Ca rules/int chi tiết (§3): [test-plan-cases.md](test-plan-cases.md).

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
| **AC-PB2-09** `## Bàn giao` vào prompt, không nhúng file; thiếu ⇒ `template_invalid` | RH-01…RH-09 · DF-05…DF-09 · HO-01…HO-07 | R, I |
| **AC-PB2-10** resume cùng agent; đổi agent ⇒ không | RR-01…RR-09 · RS-01b · RZ-01…RZ-09 | R, I |
| **AC-PB2-11** RLS `process_back_events`; ngoài phòng không lộ `back_events` | M-05…M-08 · BV-04, BV-05 · E-PB2-27 | I, E |
| **AC-PB2-12** e2e admin canvas + chat | E-PB2-01…E-PB2-12 · E-PB2-20…E-PB2-28 | E |
| HUB-FR-104 (mô hình bước) | RD-*, C-*, DF-* | R, C, I |
| HUB-FR-106 (engine song song, input theo bước) | PI-*, HO-*, PF-01…PF-03 | I |
| HUB-FR-113 (lịch sử quay lại) | BV-01…BV-05, E-PB2-25 | I, E |
| HUB-FR-118 (quay lại) | RB-*, BK-*, BL-*, RC-* | R, I |
| HUB-FR-136 (Bàn giao + resume, SHOULD; G-2, G-5, G-7) | RH-*, RR-*, HO-*, RZ-* | R, I |
| HUB-BR-38 (a,b,c,d) | PI-*, RD-*, BK-* | R, I |
| ADM-FR-71 (canvas) | E-PB2-01…E-PB2-12 | E |
| CHAT-AC-59 / CHAT-AC-60 | E-PB2-20…E-PB2-28 | E |
| TECH-DEBT #135 (R18) | PT-01, PT-02 | I |

## 3. Ca cụ thể (rules · contract · int)
Tách file: [test-plan-cases.md](test-plan-cases.md) (rules/`s0`/`par`/`back`/`tok`/`compat`; mã ca RD, RH, RR, RS, RB, C, M, DF, PI, PF, RA, PT, BK, BL, RC, BV, HO, RZ, CP).

## 4. E2E (`e2e/P-b2/`, nhãn **nguyên văn** plan-fe §7 + i18n; số bước hiển thị = `step+1`, G-4)

Fixture e2e (`e2e/P-b2/_pb2-data.ts`, SQL như `_pa-data.ts`): def `pb2-par` + `pb2-full` (bước 1 có 3 stage) + mẫu platform `sdlc`; run seed (`seedRun` mở rộng): (a) `pb2-par` bước 1 cả hai `waiting_review`; (a') `pb2-par2` bước 1 cả hai `waiting_review` (E-PB2-24); (b) run có 2 `back_events`, stage 1 có v1/v2; (c) run `needs_decision back_limit`; (d) `pb2-par` bước 1 `waiting_review` với `back_rounds=3`. DB `pb2_e2e` (DROP schema như `done-pb`).

**Admin — `e2e/P-b2/admin/canvas.pb2.ts` (ADM-FR-71, AC-PB2-12)**
| Ca | Thao tác | Kỳ vọng |
|---|---|---|
| E-PB2-01 | mở `pb2-par` | `application "Canvas quy trình"`; 4 `button` `/^Giai đoạn [1-4]: /`; `complementary "Chi tiết giai đoạn"` chứa `region "Giai đoạn 1: Phân tích"` (chọn sẵn, FB7) |
| E-PB2-02 | click `button /^Giai đoạn 3: Test hồi quy/` | panel đổi sang `region "Giai đoạn 3: Test hồi quy"`; `spinbutton "Chạy ở bước"` giá trị = `step+1` (1…10) |
| E-PB2-03 | focus node `Giai đoạn 2: Rà soát code` + `Alt+ArrowRight` | `status` "Giai đoạn n chuyển sang bước m" (n theo mảng sau sắp); `spinbutton` cập nhật; trang **không** lùi lịch sử (URL giữ) |
| E-PB2-04 | kéo node `Tổng hợp` (mouse) sang cột của bước 2 | bước đổi; giờ cột đó có 3 stage |
| E-PB2-05 | `pb2-full`: `Alt+ArrowRight` stage bước 0 sang bước 1 (đã 3) | `alert` chứa "Bước n đã đủ 3 giai đoạn song song." + status "Không chuyển được: bước n đã đủ 3 giai đoạn"; bước không đổi; `button "Thêm giai đoạn vào bước n"` `aria-disabled=true` |
| E-PB2-06 | panel `Tổng hợp`: `group "Nếu bị trượt"` → `checkbox "Quay lại bước n"` (assert `toHaveAccessibleDescription` chứa tên stage của bước đó) → `Lưu` (chờ PUT 200) → reload | checkbox vẫn checked; node có chữ "↩ bước n"; GET def `back_to_steps` đúng, `required_sections` có `"Bàn giao"` |
| E-PB2-07 | stage bước đầu | khối "Nếu bị trượt" có câu "Bước đầu không có bước nào phía trước."; stage gate tự động ⇒ `group "Nếu bị trượt"` chỉ có câu `backNone`, không checkbox |
| E-PB2-08 | `real_action`: stage bước sau khi bước trước có stage auto | `switch "Hành động thật"` disabled (câu `realLocked` mới); đổi stage đó sang duyệt ⇒ enabled |
| E-PB2-09 | panel nút `Chuyển sang bước sau` / `Tách sang bước riêng` / `Lên` / `Xuống` (không dùng phím) | bước/thứ tự đổi giống E-PB2-03 (đường a11y thay thế, FB8) |
| E-PB2-10 | `tablist "Chế độ xem"` → `tab "Danh sách"` | danh sách theo bước với `button "Giai đoạn n: …"`; panel vẫn hoạt động. Biến thể: `page.route("**/canvas*.js", abort)` ⇒ `alert` "Không tải được canvas. Đang dùng dạng danh sách." + `button "Thử lại"`; viewport 700 px ⇒ mặc định Danh sách |
| E-PB2-11 | focus node + `Enter` | panel mở, focus ở `textbox "Tên giai đoạn"`; `Delete` ⇒ `alertdialog "Xoá giai đoạn “…”?"` |
| E-PB2-12 | mẫu `sdlc` | "Đây là quy trình mẫu, chỉ xem. Chép mẫu để chỉnh sửa." + "Quy trình mẫu: chỉ xem, không kéo thả được."; không `button "Thêm giai đoạn"`; `Alt+ArrowRight` không đổi gì |

**Chat — `e2e/P-b2/chat/run.pb2.ts` (CHAT-AC-59/60, HUB-FR-113, AC-PB2-12)**
| Ca | Kỳ vọng |
|---|---|
| E-PB2-20 | run `pb2-par` trong phòng: `list "Tiến độ quy trình"` 3 `listitem`; con `list "Bước n — chạy song song"` 2 mục (Rà soát code, Test hồi quy) |
| E-PB2-20b | run `hoa-don-t` (cũ): strip không có chữ "Bước" (giao diện cũ, AC-PB2-01) |
| E-PB2-21 | seed (a): 2 thẻ duyệt nhóm dưới `group "Bước n"` (Q7) |
| E-PB2-22 | thẻ `Test hồi quy`: `button "Chưa đạt"` → `radiogroup "Chưa đạt thì…"`: `radio "Làm lại giai đoạn này"` checked, `radio "Quay lại bước n"`; chọn quay lại ⇒ `note` "Còn 3 lần quay lại. Các bước từ n trở đi sẽ chạy lại; kết quả cũ vẫn xem được."; bấm `Gửi chưa đạt` khi trống ⇒ câu lỗi góp ý cũ; điền `textbox "Góp ý"` "Thiếu ca hồi quy" ⇒ toast "Đã quay lại bước n. Các giai đoạn sẽ chạy lại với góp ý của bạn."; sau khi Runtime giả chạy lại ⇒ strip có `×2` |
| E-PB2-22b | seed (d): thẻ `Test hồi quy` (`back_rounds=3`) | `radio "Quay lại bước n"` **vẫn hiện**; chọn nó ⇒ `note` "Đã hết 3 lần quay lại. Gửi sẽ chuyển cho người quyết."; gửi (có góp ý) ⇒ run `needs_decision` (thẻ "Cần người quyết" `back_limit`) |
| E-PB2-23 | thẻ `Rà soát code` (không `back_to_steps`) | không có `radiogroup` (hành vi cũ) |
| E-PB2-24 | 2 người (B, T — 2 context) cùng quay lại ở seed (a') (`pb2-par2`) | một toast thành công; người kia toast "Giai đoạn này vừa được xử lý ở bước khác. Đã cập nhật." và thẻ đóng |
| E-PB2-25 | seed (b) trang Run `/runs/:id` | `group "Bước n"` (+ "×2 lần"); `list "Lịch sử quay lại"` 2 `listitem` chứa "Vòng 2 · … → quay lại bước n"; `tab /^Bản 1/`, `tab /^Bản 2/` (Bản 2 "mới nhất" chọn sẵn) |
| E-PB2-26 | seed (c) thẻ "Cần người quyết": "Đã quay lại tối đa 3 lần mà chưa đạt." + 3 nút sẵn có; bấm nút `add_attempt` (**nhãn cũ**) ⇒ run chạy lại (strip `×` tăng) |
| E-PB2-27 | H (ngoài phòng, có task) mở Run | không có `list "Lịch sử quay lại"` (AC-PB2-11) |
| E-PB2-28 | strip seed (b): dòng "↩ Quay lại bước n (lần 2)"; run `back_rounds=3` ⇒ "Đã quay lại tối đa 3 lần" |

## 5. Test khoá cũ — sửa có chủ đích ở T2 (qc, TRƯỚC relock; không phải "Tranh chấp")

| File · ca | Sửa | Lý do (nguồn) |
|---|---|---|
| `P-a/step0/rules/contracts-pa.test.ts` L162 | `toHaveLength(15)` ⇒ `16` (+ kiểm phần tử cuối `back_limit`) | plan §1.1, §8 |
| cùng file L178–200 (tên "đúng 12 mã") | thêm `BACK_TARGET_INVALID: 422`; đổi tên "13 mã" | plan §1.1 |
| `P-b/pfs3/_local.ts` (`mkDef` qua `POST /process-defs` + `MD_AUTO`/`mdWithRefs`) | output fixture thêm `## Bàn giao` (vì `ensureHandoff` ⇒ thiếu = `template_invalid`) | R10, Q3, plan §8 dòng 4 |
| ca e2e P-a/P-b assert **tên mục thiếu** (bước `missing` của runtime giả cắt mục cuối; với def lưu qua API mục cuối nay là `Bàn giao`) | kiểm ở WRITE bằng Grep assert đó; sửa chỉ khi test thật sự gãy — **không** sửa `_pa-runtime`/`_pb-runtime` | R10, G-5 |
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
| G1 | ~~Số bước hiển thị~~ **Đã chốt (G-4):** UI = `step+1`, `spinbutton` 1…10; e2e viết theo đó | — | xong |
| G2 | ~~AC-PB2-06 ≠ D7~~ **Đã sửa AC** (spec §8) theo D7; BK-03 khớp | — | xong |
| G3 | `backResetPlan` có trả stage bước < X? | không trả (RB-11, D7) | chốt |
| G4 | ~~Nhãn `add_attempt`~~ **Đã chốt (plan-fe §5/§9 B5):** giữ nhãn cũ | — | xong |
| G5 | ~~Cảnh báo cắt Bàn giao~~ **Đã chốt:** chỉ cờ `handoff_truncated`, không UI; chỉ kiểm API (HO-02) | — | xong |
| G6 | `pickDecisionStage` hoà `createdAt` | không test hoà | — |
| G7 | `runStatusOf([])` / có `cancelled` trong bước | không test | — |
| G8 | `done:pb2` (`tools/scripts/src/done-pb2.ts` + script `package.json`) ngoài quyền qc | §7 đặc tả bước; **T11 tạo** (tasks.md) | backend-lead |
| G9 | Fake runtime e2e cần chạy 2–3 job cùng bước + kịch bản theo `stage_idx` (đã có `rtScript(target, stageIdx, …)`) — kiểm khả năng claim song song | dùng `rtScript` mỗi stage | qc kiểm ở WRITE; thiếu ⇒ backend-lead |

## 7. Cổng `done:pb2` (đề xuất; mẫu `done-pb.ts`, dừng ở bước đỏ đầu, `--from`, `--skip=int,e2e`)
1. Tĩnh: `bun run check` (biome) · `bun run typecheck` · `bun run i18n:check` · `bun run check:size`.
2. Contract + rules: `bun test packages/contracts` · `bun test tests/acceptance/P-b2` (rules; bunfig bỏ `*.int`) · `bun test apps/hub-api apps/admin-web apps/chat-web` (unit dev: `step-ops`, `canvas-layout`, `groupBySteps`, `check-bundle`).
3. Int P-b2: mỗi lát `db:test:create <tag>` + `bun --env-file=.env.test-<tag>.local --config=bunfig.int.toml test --timeout 60000 tests/acceptance/P-b2/<dir>` cho `s0`, `par`, `back`, `tok`, `compat`.
4. Hồi quy liên quan (int): `P-a/step0`, `P-a/pf1`, `P-a/pf2`, `P-a/scenario` (tag `pa_*` sẵn có) · `P-b/pfs1`, `P-b/pfs3`, `P-b/pfs4` · `X2b2/regress`. (Bỏ `P-b/pfs2` stack — không chạm Runtime; chạy trong `done:pb` đủ ở T11.)
5. Build + bundle: `bun run --filter @ai/admin-web build && bun run --filter @ai/admin-web check:bundle` (chunk `canvas*` ≤ 80 KB, initial không đổi) · `bun run --filter @ai/chat-web build && … check:bundle`.
6. E2E: DB `pb2_e2e` (DROP schema) → `bunx playwright test -c e2e/P-b2/playwright.pb2.config.ts`; hồi quy `-c e2e/P-a/playwright.pa.config.ts e2e/P-a/pf4 e2e/P-a/scenario` và `-c e2e/P-b/playwright.pb.config.ts e2e/P-b/admin e2e/P-b/chat`.
7. Khoá/truy vết: `bun run test:lock:verify` · `bun run trace --check`.
8. UAT (qc-uat, T11; không nằm trong script): **bắt buộc 1 ca resume Claude thật** (redo cùng stage, cùng agent, session ≤ 86400 s ⇒ resume + delta; G-7) và 1 ca session quá hạn ⇒ chạy mới.
T11 tạo `done-pb2.ts` (backend-lead) và vẫn chạy **đủ** `done:pa` và `done:pb` một lần (spec §8).

## 8. Kết quả (điền ở WRITE/VERIFY)
### Đỏ đúng lý do (bắt buộc trước LOCK)
| Lát | DB tag | Số ca | Đỏ ở | Ghi chú |
|---|---|---|---|---|
| rules | — | — | — | chưa viết |
| s0 / par / back / tok / compat | `pb2_*` | — | — | chưa viết |
| e2e admin / chat | `pb2_e2e` | — | — | chưa viết |
### Sửa test khoá (§5)
- (chưa)

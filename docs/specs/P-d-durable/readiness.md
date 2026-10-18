# Readiness · P-d-durable

Mỗi lần chạy spec-readiness thêm một dòng (mới nhất ở trên). Báo cáo đầy đủ dán bên dưới dòng đó hoặc lưu file riêng.

Điều kiện Gate đã biết trước: ADR-0017 **Accepted** (còn thiếu Redis thật + tải 10.000 run trên staging); mockup/artboard panel stage + nhãn chat (D13); security review cho chuyển cấp và vòng hẹn giờ; mốc dọn-seed (CR-081) đã đóng.

| Ngày | Kết quả | Chặn | Cao | Thấp | Ghi chú |
|---|---|---|---|---|---|
| 2026-10-18 | READY (P-d2 lần 2, vòng cuối, T16) | 0 | 0 (4 Cao mới đóng bằng D2-43…D2-47) | 5 | Diff 31bea54..69f6df2. #97–#102 và Thấp #103–#111 đóng. Mới (từ T15c): #112 nhãn E01 ↔ i18n `argValue`; #113 input `number` đụng test khoá `contracts-pd1:86` + thiếu luật start/FE; #114 tên trường wait/retry `ProcessRunSummary` + không ca giá trị; #115 notice chuyển cấp D2-34 thiếu tên trường + không ca — đều ghi mặc định vào `spec-decisions` (D2-43…47). Điều kiện trước T17: qc áp phần test của D2-43/44/45/47. Không hỏi người dùng. |
| 2026-10-18 | NOT READY (P-d2 lần 1, T16) | 0 | 6 | 9 | Vòng 1/2 (WORKFLOW Kỷ luật token #5). Cao: #97 PD2-P04 "khớp − không khớp = 4" ↔ plan §7 (đọc `fields` cả hai ca); #98 thiếu đo trước + perf trong Lệnh xong; #99 T17 thiếu barrel lớp; #100 kiểu nguồn ↔ kiểu tham số tool; #101 stage `tool` `after.review` bị settle thẳng `done`; #102 e2e PD2-E01…E05 chưa có/chưa giao. Đều có mặc định ⇒ docs-architect áp ngay, vòng 2 chỉ diff. Điều kiện Gate: ADR-0022 Proposed + D2-02 dùng pipeline `/mcp` hiện có (đạt), T20 gồm S1–S12 (đạt), PD2-P01…P04 có ngưỡng + test (đạt, sửa #97). Không hỏi người dùng. |
| 2026-10-18 | READY (lần 7) | 0 (+điều kiện Gate ngoài spec) | 0 | 11 | Diff d91d2d9. Đóng #90 (notice `run_finished` chèn trong tx `systemBatch`, Redis sau COMMIT; A10 ↔ A11 khớp; hết hạn 5 câu so với lượt rỗng ≤ 6 = PD-P15), #92 (`test:perf:pd` thêm ở T9), #93, #94. Mới: #95, #96 (Thấp). Còn Thấp: 71, 73, 75–80, 91, 95, 96. Không hỏi người dùng. |
| 2026-10-18 | NOT READY (lần 6) | 0 | 1 | 12 | Diff 70bd139. Đóng #81 (A11 `systemBatch`, CA-R06/§4/§7, T6b/T6c), #82, #83–#89, #74, TC1–18. Cao mới do chính bản sửa: #90 `Notifier.runsFinished(ids)` — A11 xếp vào "repo lô gắn tx" ↔ A10 "adapter gom vào outbox xả sau COMMIT" (notice `run_finished` ghi trong hay ngoài tx). Thấp còn: 71, 73, 75–80 + mới 91–94. Không hỏi người dùng. `check:size` không có vi phạm ở docs; trần không đổi. |
| 2026-10-18 | NOT READY (lần 5) | 0 | 2 | 34 | Diff 75ec598..3efb39f (ADR-0017 Accepted, CR-081 đóng, mockup duyệt, A9/A10, test-plan-addendum §2–§3, test T3/T3a). Cao: #81 A10 một tx hệ thống/lô nhiều tenant ↔ spec-ca CA-R06/K1 (UoW theo tenant, mỗi hàng); #82 NFR "đo riêng phần DB" ↔ PD-P13/P14 đo cả lời gọi. 18 tranh chấp qc đều Thấp, có mặc định. Không hỏi người dùng (Luật 2b). Điều kiện Gate ngoài spec đã đủ (D0a–D0c). |
| 2026-10-17 | READY (lần 4) | 0 (+điều kiện Gate ADR-0017 — chờ staging) | 0 | 9 | Đóng #54–#70, #72; #55–#58 đã đóng. Còn Thấp: #71, #73, #74–#80 (sửa khi BUILD, T4 chạy lại readiness chỉ diff). Không hỏi người dùng. Gate P-d1 chờ điều kiện ngoài spec (ADR-0017 staging, mockup, security review T6c/T12/T20, CR-081). |
| 2026-10-17 | NOT READY (lần 3) | 0 (+1 điều kiện Gate ADR-0017 — chờ staging) | 4 | 19 | Đóng #33–#35, #37–#39, #41–#48, #50–#52; #40 sinh mâu thuẫn mới. Còn: plan-addendum chưa được trỏ từ tasks/plan (#55), escalate ở stage auto 422↔400 (#56), PD-U68↔plan-domain:119 (#57), path WAIT phía contract + PD-C13 (#58). Mọi mục (a) sửa theo mặc định (Luật 2b); không hỏi người dùng. |
| 2026-10-17 | NOT READY (lần 2) | 4 (1 là điều kiện Gate ADR-0017) | 10 | 8 | Đã có plan/plan-frontend/test-plan/mockup; đóng #1,#3,#6,#8–#12,#14,#15,#17,#19–#21,#24,#25,#27–#32. Còn: lệch spec↔plan (400/422, run_steps 'tool', vị trí step.rules/T18s, ngưỡng escalate, audit grant/revoke, quyết định plan chưa vào spec), ADR-0023 khi dời file import contract, e2e lệch nhãn FE, G1–G7, teamResumePlan, T10 rủi ro. Mọi mục (a) sửa theo mặc định (Luật 2b); hỏi người dùng 1 câu (ADR-0017). |
| 2026-10-17 | NOT READY (lần 1) | 6 | 13 | 6 (+7 Vừa) | Chưa có plan/plan-frontend/test-plan/mockup; phân loại lỗi (Q2), side_effect, team retry (Q1), quyền tool P-d2; khoá idempotency va chạm; thứ tự khoá timer↔run; FORCE RLS sai; thiếu nới CHECK audit/thread; ESCALATE_INVALID↔PROCESS_REF_INVALID; AC-H41 sai trần. Hỏi người dùng 4 câu. |

## Lần chạy

### Lần 2 (P-d2) · 2026-10-18 · READY (vòng cuối)

Phạm vi: `git diff 31bea54..69f6df2` (a02a9d1 áp mặc định #97–#111; 69f6df2 T15c) — 7 file docs P-d2 + test/e2e đổi; đối chiếu `hub-admin/sources.ts:63-104`, `chat/processes-entities.ts:102,159-176,366`, `hub-admin/processes.ts:140`, `plan-frontend-i18n §4:119-126`, mockup 03 D4, `contracts-pd1.test.ts:86`. Chạy `bun test tests/acceptance/P-d/rules/d2`: 0 pass / 56 fail, 100 % "chưa có cổng lớp … (T17/T18a)" / "chưa có tính năng" — đỏ đúng lý do. Kích thước (byte, trần L): spec-d2 10646/12288 · plan-d2 18429/18432 · plan-frontend-d2 15050/15360 · test-plan-d2 18406/18432 — đạt.

Đóng: #97 (plan-d2 §9 + D2-33 + `d2.perf:289`) · #98 (tasks T18s/T18-1/T19s/T17b "Đo trước" + perf trong Lệnh xong, D2-31; `bunfig.perf.toml` có) · #99 (T17 File barrel + enum, Lệnh xong `contracts-pd2` + depcruise) · #100 (D2-29, plan-d2-rules §2, `inputTypes`, U02b/U04/I17) · #101 (D2-30, plan-d2 §3–§4/§7, I18 review/auto) · #102 (T15c, `e2e/P-d/*.pd.ts` E01…E05) · #103 · #104 (cả 4 file dưới trần) · #105 (D2-24…28, 35…41) · #106 · #107 · #108 · #109 (I02 int `tool.int:139`, I43 `:105`, I45 `:142`, P01 `:108`, P03 `:226`) · #110 · #111.

| # | Mức | Mục | Vị trí | Vấn đề | Mặc định (đã ghi) |
|---|---|---|---|---|---|
| 112 | Cao | E, I | `admin-stage.pd.ts:144` ↔ plan-frontend-i18n:120 | T15c-1 đặt nhãn mới "Trường của tham số {name}" trong khi i18n đã có `…tool.argValue` "Giá trị của tham số {{name}}" cho chính ô này (mục `fieldOpt`) ⇒ hai nhãn | D2-43: giữ i18n; qc sửa E01 |
| 113 | Cao | B, D, F | T15c-2a ↔ `sources.ts:63`, `contracts-pd1.test.ts:86` (khoá `toEqual` 5 kiểu) | Thêm `number` vào `INPUT_TYPES` làm đỏ test khoá P-d1; chưa có luật giá trị lúc start, ánh xạ kiểu input → `sourceType` (select/source_ref/file), UI admin/chat | D2-44 |
| 114 | Cao | B, F | T15c-2b, `d2.perf:328` (`/^(wait\|retry)/`) | Tên + nghĩa trường `ProcessRunSummary` chưa chốt (FE T20 cần); không ca nào kiểm giá trị (chỉ P05 đếm câu) | D2-45 + PD2-I52 |
| 115 | Cao | B, F | D2-34, tasks T15c "notice chuyển cấp" (grep test = 0) | Notice/History chuyển cấp chưa có tên trường; ca T15c hứa nhưng chưa viết | D2-47 + PD2-I51 |
| 116 | Thấp | L | plan-d2 §12 | Ký tự TAB thay `` `t `` ("stage <TAB>ool"), mất backtick `/mcp`; sửa đủ +6 B ⇒ 18435 > 18432 ⇒ bỏ đồng thời "(canRun chỉ stage tool; …)" (đã ở D2-24…28) | docs-architect |
| 117 | Thấp | I | plan-d2 §9 P05 "≤ trước + 5 ms" ↔ `d2.perf:337` "≤ không hẹn + 5 ms"; tên ca "1 vs 50" ↔ code 0 vs 50 | Lệch mốc so sánh | Theo test; "đo trước" vẫn ghi "Quyết định trong lúc làm" |
| 118 | Thấp | H | tasks T15c `[ ]` (69f6df2 xong); Đọc T17/T17b/T20 chỉ tới D2-34 | Tick T15c; Đọc += D2-43…47 | docs-architect |
| 119 | Thấp | F | `tool.int:162` ghi "Tranh chấp T15c-1" (đúng là T15c-2); `workflow-tools.int:93` và `:105` cùng mã PD2-I43 | Mã truy vết | qc cùng lượt #112 |
| 120 | Thấp | L | plan-addendum A1–A3 chưa nhập plan-contract §6 (từ #105) | Một nguồn | Khi chạm tiếp |

Tranh chấp T15c: T15c-1 **không** chấp (#112); T15c-2 chấp + chốt chi tiết (D2-44, D2-45); T15c-3 chấp (D2-46, chỉ dữ liệu test).

Checklist (chỉ phần diff): A Đạt (spec-d2 §1) · B Đạt sau D2-44/45/47 · C Đạt (không DDL mới; payload jsonb) · D Đạt (D2-29/30/44) · E Đạt (D2-43; i18n §4) · F Đạt sau PD2-I51/I52 + E01 · G Đạt · H2 Đạt (T15c có qc) · H Đạt (#118 Thấp) · I Đạt (#117 Thấp) · J Đạt · K Đạt (plan-d2 §9 P01–P05, tasks "Đo trước", D2-47 không thêm câu vòng chuyển cấp; grep `sleep`/`setTimeout` chờ trạng thái ở test d2 = 0) · L Đạt (4 file dưới trần; #116, #120 Thấp).

Điều kiện trước T17 (không phải câu hỏi): qc sửa E01 (#112), mã #119, thêm PD2-I51/I52 (đỏ "chưa có tính năng (T17/T17b)"); khoá `contracts-pd1:86` sửa trong T17 (D2-44). Quét từ mơ hồ trên diff: "tuỳ ý"/"tuỳ chọn" mô tả, `…` khoảng mã — vô hại. Câu hỏi người dùng: không.

### Lần 1 (P-d2) · 2026-10-18 · NOT READY

Phạm vi: `spec-d2.md`, `spec-tz-tools.md` §2, `plan-d2.md`, `plan-d2-rules.md` (T13 2fe1d77), `plan-frontend-d2.md` (T14 15652e5), `test-plan-d2.md` (T15/T15b), `spec-decisions.md` "P-d2" (D2-01…D2-23), `spec-ac.md` AC-H44/H45/H47/A15, `tasks.md` T13–T20, `mockup/04`, mục được trỏ (`plan-contract` §2/§6–§8, `plan-addendum` A1–A4, `plan-db` §3–§4, `test-plan-e2e` PD2-E01…E05); test `rules/d2/*`, `d2/*.int`, `perf/d2.perf.int`, `admin/workflow-tools.int`, `_support/modules.ts`; code: `mcp/mcp.service.ts`, `mcp/mcp.rules.ts` (`validateToolArgs`), `runs/apply-settle.ts`, `core/handles.ts`, `adapters/drain.ts`, `defs/{def.rules,teams.repo}.ts`, `application/ports.ts`, contracts `chat/processes-entities.ts`, `common.ts`, ADR-0022. Mã: HUB-FR-146/147, ADM-FR-73, HUB-BR-12/20/27/38, AC-H44/H45/H47/A15. Kích thước (trần L): spec-d2 10600/12288 · plan-d2 18413/18432 · plan-frontend-d2 15421/15360 · test-plan-d2 23290/18432.

#### Cao (đóng trước T17 — docs-architect áp mặc định cùng lượt, vòng 2 chỉ diff)
| # | Mục | Vị trí | Vấn đề | Mặc định |
|---|---|---|---|---|
| 97 | K | plan-d2:114 ↔ `perf/d2.perf.int.test.ts:236-241`, test-plan-d2:121 | Ca thứ 2 PD2-P04 so "khớp − **không khớp** = 4", nhưng plan §7 phải đọc `currentFields` để đánh giá ⇒ ca không khớp cũng trả câu `fields` ⇒ hiệu đúng là 3; code đúng plan sẽ đỏ. Ngoài ra "join p95 ≤ 30 ms" (plan) ↔ test đo cả `POST decision` Đạt + `settled()` | Plan §9 + test: "khớp − def không `branch` = +4; không khớp − def không `branch` = +1 (`fields`)"; qc sửa ca 2 dùng def không `branch` làm mốc. Ngưỡng 30 ms áp cho đúng khoảng test đo (POST Đạt + `settled()`); sửa chữ plan §9 |
| 98 | K | tasks T18s/T18/T19s/T19 Lệnh xong; plan-d2:111, :151 | Đường nóng cũ bị chạm (pipeline `/mcp`, lưu def, `settleStep`/join) — chỉ PD2-P01 có "đo trước ở T18-1"; T18s/T19s không có bước đo trước; không task nào chạy `d2.perf.int` (CLAUDE.md: `test:perf` ngoài Lệnh xong; tiền lệ P-d1 #92 thêm vào Lệnh xong) | T18s: ghi số câu + p95 của một lời gọi `/mcp` (H2a) trước/sau tách. T18-1: đo PD2-P01 (bản không tool) trước khi sửa. T19s: đo số câu + p95 POST Đạt + `settled()` def 5 bước không `branch` trước khi dời. Ghi "Quyết định trong lúc làm". Lệnh xong: T18-1 += `bun run test:perf tests/acceptance/P-d/perf/d2.perf.int.test.ts -t "PD2-P0[12]"`, T18-2 += `-t PD2-P03`, T19 += `-t PD2-P04` |
| 99 | H, H2 | tasks T17 (File, Lệnh xong) ↔ test-plan-d2:7, `_support/modules.ts:36-57`, plan-d2 §5 | Test P-d2 nạp barrel `P/domain/index.ts`, `P/application/index.ts` "thêm ở T17" + domain `StageRunStatus`/`DecisionReason`/`ExecutorKind` thêm ở T17, nhưng File T17 chỉ `packages/contracts/**`, `packages/db/**`; plan-d2 §2 không có barrel (Glob: chưa tồn tại) | T17 File += `P/domain/index.ts`, `P/application/index.ts` (chỉ re-export, không logic) + file kiểu domain enum; Lệnh xong += `bun test tests/acceptance/P-d/rules/d2/contracts-pd2.test.ts && bun run depcruise`; ca U còn đỏ "chưa có tính năng (T18/T19)" là đúng |
| 100 | D, J | PD2-R02; plan-d2:41 (`inputs: Map<string,string>`); plan-frontend-d2:11 (const `value: string`); `mcp.rules.ts:141-170` | `/mcp` (`validateToolArgs`) đòi `number` là số JS, `select` ∈ `options`; nguồn `input` là chuỗi, const từ FE là chuỗi; `toolStageIssues` không kiểm kiểu nguồn ↔ kiểu tham số ⇒ def lưu được rồi chạy ra `INVALID_ARGS` ⇒ `tool_failed`. Không ghi đổi kiểu hay chặn lúc lưu (hai cách hiểu) | Lưu def: `TOOL_INVALID` path `stages.<i>.executor.args.<name>` khi nguồn không hợp kiểu — ma trận chung với FE `paramCompatible`: `number` ← input/field `number` hoặc const số; `boolean` ← const boolean; `select` ← const ∈ `options` hoặc input/field chuỗi; `text`/`paragraph` ← mọi nguồn (số/ngày `String()`). Chạy: `buildToolArgs` đổi input kiểu `number` sang `Number` (ToolCallLoad mang kiểu input). FE gửi const đúng kiểu param. qc thêm ca PD2-U02/U04 |
| 101 | D | PD2-R08 (`after` review/auto), PD2-R12; plan-d2:48, :73; `runs/apply-settle.ts:69-104` | `settleOk` = "output + stage done + join"; `settleApply` (đích tách T18s) chỉ có `done`/`decision` ⇒ stage `tool` có `after.review` (bắt buộc khi rẽ nhánh tới đích `real_action`) bỏ qua gate. Mọi test dùng `toolStage` mặc định `auto` (`_d2.ts:250`) | `settleOk` sau khi ghi output đi cùng đường hậu-output của stage agent: `review` ⇒ `waiting_review` + review task (nhắc/chuyển cấp P-d1 áp như agent), nhánh đánh giá khi Đạt; `auto` ⇒ `done` + join. qc thêm ca int "tool `review` ⇒ `waiting_review`; Đạt ⇒ rẽ nhánh". PD2-P03 giữ đo `auto` |
| 102 | F, H | test-plan-e2e:20-24 ↔ `e2e/P-d/*.pd.ts` (grep PD2/"Gọi tool" = 0); tasks T15 File, T20 Agent | PD2-E01…E05 chưa viết; T15 chỉ `tests/acceptance/P-d/**`, T20 không có qc ⇒ không ai viết e2e trước code (Luật 3, 4b; `e2e/**` khoá sau Gate) | Thêm **T15c** (qc, trước Gate/T17): PD2-E01…E05 vào `e2e/P-d/{admin-stage,admin-tenant,chat-labels}.pd.ts`, đỏ đúng lý do; kèm các ca của #100, #101, #109 |

#### Thấp (sửa khi BUILD hoặc cùng lượt áp Cao)
103 tasks T15 còn `[ ]` dù test-plan-d2:123-126 ghi T15/T15b xong ⇒ tick · 104 L trần: plan-frontend-d2 15421 > 15360, test-plan-d2 23290 > 18432 ⇒ cắt văn xuôi/lặp (mục "Đỏ đúng lý do" lịch sử, tranh chấp đã xử lý ⇒ một dòng); plan-d2 18413 sát trần · 105 L một nguồn: Q-T13-1…5 (plan-d2 §12), Q-T14-1…4 (plan-frontend-d2 §15), Q-D2-*/Tranh chấp T15 (test-plan-d2 §6) là quyết định ngoài `spec-decisions` ⇒ chép thành D2-24… ở "P-d2", nơi khác trỏ mã; P-d2 vẫn dựa phụ lục sửa đổi `plan-addendum` A1/A2/A3/A7 (plan-contract:142 "thay bởi") ⇒ khi chạm tiếp, nhập A1–A3 vào plan-contract §6 (không chặn: tasks:3 "plan-addendum thắng" rõ thứ tự) · 106 A1 `tool-catalog.repo` ↔ plan-d2 §2 `tool-switch.repo.ts` ⇒ theo plan-d2 (mới hơn, khớp File T18) · 107 plan-d2 §10 S1 + PD2-I01 `tenantKey(...)` ⇒ symbol thật `tenantKeyOf(catalog, tenantId)` (`config/catalog.rules.ts:288`) · 108 PD2-R03 "Timeout = `timeout_s`" ⇒ trỏ D2-17 (`min(timeout_s, HUB_DIFY_TIMEOUT_MAX_S)`) · 109 test thiếu so với test-plan: PD2-I02 chỉ ở unit (`run-tool-stage.test.ts:183`, AC-H44 ghi int); I43 "DELETE lần 2 không đổi", I45 "tenant không tồn tại ⇒ 404", PD2-P01 "≤ trước + 5 ms", PD2-P03 "≤ 14 câu" chưa assert ⇒ qc thêm ở T15c · 110 PD2-P03 bắt đầu đếm sau `waitStageStatus(s0 done)` — launch stage tool có thể đã chạy trước ⇒ số câu dao động ⇒ đếm từ trước `jobDone` s0 (hoặc chỉ tx tool-driver, khớp "ngoài launch") · 111 Lệnh xong T18a/T18/T19s/T19 dùng `bun run test:int` cả bộ ⇒ `bun run test:int:par <thư mục liên quan>` (Luật 4c), bộ đầy đủ ở T20.

#### Hai mục P-d1 người dùng có thể dời vào T17 (không tính là lỗ hổng P-d2)
- **Notice chuyển cấp (mockup 03 D4):** `ProcessNoticeSchema` (`chat/processes-entities.ts:366`) chưa có tên Group/số giờ; `HistoryItem.kind` đã có `escalate` + `group` (:162, :175) nhưng chưa có giờ. `hub.process_notices.payload jsonb` có sẵn ⇒ không DDL, không đổi thứ tự enum. **T17 nhận được** phần contract (trường optional thêm cuối); cần thêm vào File T17 chỗ ghi payload ở notifier Hub + mapper view + ca test qc (T15c); hiển thị chat ở T20.
- **`ProcessRunSummary` wait/retry (danh sách run admin):** schema (:102-119) chưa có. **T17 nhận được** phần contract (optional). Phần Hub là đường nóng mới (danh sách run): một câu theo tập cho cả trang (`process_timers`/`stage_runs` lọc `= any(ids)`), test đếm câu + ngưỡng p95 + đo trước (mục K) ⇒ nên đặt ở T18-1 hoặc task nhỏ T17b, không nhồi vào T17 (rủi ro vượt 400 dòng).

#### Mâu thuẫn
- plan-d2 §9 PD2-P04 ↔ test PD2-P04 ca 2 (#97) · `plan-addendum` A1 ↔ plan-d2 §2 tên repo (#106) · spec PD2-R03 ↔ D2-17 (#108).

#### Câu hỏi người dùng
Không có (mọi mục có mặc định; không mục nào thuộc kinh doanh/bảo mật/chi phí/phạm vi mới).

#### Checklist
| Mục | Kết quả | Bằng chứng |
|---|---|---|
| A Phạm vi | Đạt | spec-d2 §1 "Không làm"; spec-tz-tools §2 |
| B Contract | Đạt | plan-contract §6–§8, plan-addendum A1/A2; workflow-tools route/lỗi plan-contract:146-160 |
| C Dữ liệu | Đạt | plan-db §3 (0037 CHECK), §4 (0012 DDL/RLS/FK/index); TT-R01/R02 |
| D Nghiệp vụ | Thiếu | #100, #101; còn lại PD2-R01…R15, plan-d2 §4, §7 |
| E UI | Đạt | plan-frontend-d2 §10–§13, mockup 04 E1–E4, i18n §4 |
| F Kiểm chứng | Thiếu | #102, #109 |
| G Phụ thuộc | Đạt | Dify giả `_d2.ts` + `tool-net` (test-plan-d2:5); ADR-0022 Proposed ⇒ D2-02 |
| H2 Vai trò | Thiếu | #99 (barrel), #102 (e2e) |
| H Task | Thiếu | #98, #99, #102; Rủi ro T17–T20 `cao` đúng |
| I Nhất quán | Mâu thuẫn | #97, #106, #108 |
| J Độ chính xác | Đạt (trừ #107) | plan-d2-rules §1 chữ ký; plan-d2 §2 file |
| K Hiệu năng | Thiếu | #97, #98; plan-d2 §9 có số câu/index/ngưỡng; không vòng hàng/sleep (grep test d2 = 0) |
| L Gọn, một nguồn | Thấp | #104, #105 |

Điều kiện Gate: ADR-0022 **Proposed** (`docs/adr/0022…:3`), mặc định = pipeline `/mcp` hiện có (D2-02, plan-d2 Q-T13-5) — đạt theo T16. Security T20: Đọc gồm `plan-d2 §10 (S1–S12)`; S1/S5 ⇒ PD2-I01, S2/S9 ⇒ I21/I23/I24 + `run-tool-stage`, S4 ⇒ I04/I10, S6 ⇒ I15, S7 ⇒ I44/I46, S8 ⇒ chạy lại H2a/X1, S10 ⇒ I26, S11 ⇒ `uow-boundary.test`, S12 ⇒ `run-tool-stage` S12; S3 chỉ review — đạt. PD2-P01…P04: plan-d2 §9 + test-plan-d2 §3.7 + `perf/d2.perf.int.test.ts` — đạt sau khi sửa #97.

Quét từ mơ hồ: 30 kết quả (dấu `…` trong khoảng mã, `≈` ước lượng dòng, "dự kiến" tên migration đã chốt ở plan-db, "tuỳ ý"/"tuỳ chọn" là mô tả) — vô hại; không lỗ hổng mới.

Chưa kiểm: mockup 02 (C1–C5) và `plan-frontend-i18n` §4 chỉ đối chiếu nhãn e2e; nội dung `tool.int`/`branch.int`/`tool-switch.int` đọc theo mã ca, không chạy test.

### Lần 7 · 2026-10-18 · READY

Phạm vi: `git show d91d2d9 -- plan-addendum.md tasks.md spec-decisions.md` + lỗ hổng mở của "### Lần 6"; đối chiếu test-plan-addendum §2 (PD-P14/P15), TC16/TC18, `package.json`. Kích thước sau diff: plan-addendum 29737 · tasks 19816 · spec-decisions 17765 (file này không có trần ở lần 5/6; spec/plan/test-plan không đổi trong diff nên giữ trần cũ).

Đóng:
- **#90** — A10 (hết hạn): `Notifier.runsFinished(ids)` gắn tx `systemBatch`, chèn `run_finished` trong tx bằng một câu `insert hub.process_notices … select` theo `(id, tenant_id)` + một câu `unread`, rồi `outbox.emit({kind:"user_events"})`, Redis chỉ sau COMMIT. A11 bảng "Repo lô" ghi cùng nghĩa ("không `Tx`; gắn tx `systemBatch`, notice chèn trong tx, Redis sau COMMIT — #90"). Hai chỗ hết mâu thuẫn; khớp code hiện có (`notifier.ts` chèn trong tx) + "Không đổi hành vi". Ngân sách: hết hạn = 5 câu so với lượt rỗng ≤ 6, khớp test-plan-addendum PD-P15 (hết hạn ≤ 6, tính chênh so với lượt rỗng, TC18). Nhắc vẫn 6 (A10:191), cộng lại đúng sau khi đổi thứ tự.
- **#94** — A10 nhắc: khoá → nạp người nhận (1 câu) → luật lớp 1 (`remind.rules`, `noticeRecipients`) → `markRemindedMany` → `insertMany` → `unread`; không còn dùng dữ liệu trước khi nạp. Số câu không đổi (6).
- **#92** — Lệnh xong T9/T10 = `bun run test:perf:pd`; script thêm ở T9 (chấp nhận theo yêu cầu). Ghi ở spec-decisions (dòng "Trả lời readiness lần 6").
- **#93** — T12 cột Đọc có `plan-addendum A11`.
- **#91** — đã ghi mặc định ở spec-decisions (`tenant({tenantId, userId}, fn)` theo plan §3 + PD-I73) nhưng spec-ca §4:54 chưa sửa chữ; giữ Thấp (sửa khi BUILD).

#### Thấp mới
95 `spec-decisions.md` dòng cuối: bullet "Trả lời readiness lần 6" dính liền cuối dòng bullet TC1–TC18 (thiếu xuống dòng, do file không có newline cuối) ⇒ tách thành dòng riêng · 96 T9 cột File không liệt kê `package.json` (script `test:perf:pd`), và T10 dùng `test:perf:pd` nhưng chỉ phụ thuộc T6b, không phụ thuộc T9 ⇒ thêm `package.json` vào File T9, thêm T9 vào Phụ thuộc T10 (hoặc đặt script ở T6b).
Còn mở (Thấp): 71, 73, 75–80, 91.

#### Mâu thuẫn mới
Không có. Quét từ mơ hồ trên phần diff: không cụm mơ hồ mới.

#### Câu hỏi người dùng
Không có.

#### Điều kiện Gate (ngoài spec)
Như lần 5/6 (security review T6c gồm `systemBatch`, T12, T20 trong BUILD).

### Lần 6 · 2026-10-18 · NOT READY

Phạm vi: `git show 70bd139` (ADR-0017, plan-addendum A8/A9/A10/A11, plan-db §5, spec-ca CA-R06/§4/§7, spec-decisions, tasks T6/T6b/T6c/T9/T10, test-plan-addendum §2–§3, test-plan-int §1/§3/§4/§9) + "### Lần 5"; đối chiếu plan §3 (`UnitOfWork`, `TxRepos`, `OutboxEvent`), plan:67, plan §7 K1/K3, `packages/db/src/hub-scope.ts` (`HubScope`), `notify/notifier.ts` `onRunFinished` (chèn notice **trong** tx), `runs/sweeps.ts` `endRun`, test khoá `d1/{uow,isolation,batch-queries}.int`, `perf/background.perf.int`, `_support/pd.ts`, `package.json` `test:perf`, `bunfig.perf.toml` (có). Trần (không đổi trong diff): spec 25462/25600 · plan 30708/30720 · plan-frontend 24826/25600 · test-plan 30431/30720. `bun run check:size`: chỉ 3 vi phạm sẵn có ở `reference/mgmt-app-contracts/**` (code ngoài phạm vi), 0 ở docs.

Đóng: **#81** — A11 (`systemBatch(fn)` scope system, chỉ vòng nền theo tập; repo lô mang `tenant_id`; K3 lô; K1 ngoại lệ duy nhất; T8 giữ `system(tenantId)` từng hàng), CA-R06 ngoại lệ, spec-ca §4/§7, T6b/T6c Đọc A11; khả thi với `HubScope {kind:"system"}`; không chạm chữ ký `tenant`/`system` mà `d1/uow.int` dùng (PD-I73…I78 vẫn đúng). Ngân sách PD-P15 nhắc 6 câu nhất quán A10. **#82** — A10 + test-plan-addendum §2 PD-P13/P14 đo cả lời gọi, tổng lời gọi tới khi trả 0. **#83–#89**, **#74** (A8), **TC1–TC18** (test-plan-addendum §3 "Mặc định đã áp"; TC3/TC4/TC12/TC13 thêm ở A11; test-plan-int sửa TC1, TC2, TC3, TC4, TC7, TC14).

#### Cao (mới, sinh từ bản sửa #81 — sửa trước T6b/T10)
| # | Vấn đề | Mặc định |
|---|---|---|
| 90 | `Notifier.runsFinished(ids)`: A11 xếp vào "repo lô (gắn tx)" ↔ A10 "không nhận `Tx` — adapter gom vào outbox xả sau COMMIT". Hai cách hiểu: notice `run_finished` chèn **trong** tx lô (như code hiện tại `notifier.ts:146` + "Không đổi hành vi") hay **sau** COMMIT (ngoài tx, mất notice nếu sập giữa chừng, cần scope RLS riêng). `OutboxEvent` (plan §3) không có loại cho notice | Trong tx `systemBatch`: `runsFinished(rows)` = `insert hub.process_notices … select` từ `process_runs` theo `(id, tenant_id)` của `claimExpired` (kind `run_finished`, người nhận `started_by`, `tenant_id` hàng nguồn) + `unread` một câu, rồi `outbox.emit({kind:"user_events"})`; chỉ phát Redis sau COMMIT. Ngân sách hết hạn so lượt rỗng = stage 1 + task 1 + `enqueueThread` 1 + notice 1 + unread 1 = 5 ≤ 6. Sửa một câu ở A10/A11 |

#### Thấp mới (sửa khi BUILD)
91 spec-ca §4:54 `tenant(tenantId, fn)` ↔ plan §3 + test khoá PD-I73 `tenant({tenantId, userId}, fn)` (khớp `HubScope` user) ⇒ theo plan §3/test; sửa spec-ca §4 · 92 Lệnh xong T9/T10 `PERF=1 bun …` không chạy trực tiếp trên PowerShell (máy dev Windows) ⇒ thêm script `test:perf:pd` vào `package.json` ở T9 (bun shell xử lý `PERF=1`), Lệnh xong gọi `bun run test:perf:pd` · 93 T12 cột Đọc thiếu `plan-addendum A11` (security review chuyển cấp nay qua `systemBatch`); plan §7 K1/K3, plan:67, §4.9/§5 không có con trỏ "→ A11" (plan.md còn 12 byte — ghi con trỏ ở tasks T12 thay vì plan) · 94 A10 bước nhắc: (2) `noticeRecipients` chạy trước câu "người nhận" ở (3) ⇒ thứ tự đúng: khoá → `markRemindedMany` (lịch từ `remind.rules`) → nạp người nhận → `noticeRecipients` → `insertMany` → unread (vẫn 6 câu) · còn mở: 71, 73, 75–80.

#### Câu hỏi người dùng
Không có (#90 có mặc định theo code hiện có + "Không đổi hành vi" của A10).

#### Điều kiện Gate (ngoài spec)
Như lần 5 (1–2, 4 đạt; 3 security review T6c gồm `systemBatch`, T12, T20 trong BUILD).

Lần 7: docs-architect áp #90 (một câu A10/A11) ⇒ chạy lại chỉ diff.

### Lần 5 · 2026-10-18 · NOT READY

Phạm vi: `git diff 75ec598..HEAD` (spec, spec-decisions, tasks, plan-addendum A9–A10, test-plan, test-plan-addendum §2–§3, ADR-0017, CHANGE-REQUESTS CR-081/CR-093) + `git show --stat 7e27b8c 3efb39f` (`tests/acceptance/P-d/**`); đối chiếu spec-ca:13 (CA-R06), :54 (`UnitOfWork`), plan:67 (repo port), plan §4.9/§5/§6/§7 K1/K3, plan-db:33–35/128–135, plan-contract:79/87, spec PD-R10, `packages/db/src/hub-scope.ts`, `schema/hub.ts:361` (`hub.audit_log`), `migrations-hub/0019:391`, `notify/reminder.ts`, `core/task.rules.ts:51`, `runs/start-inputs.ts` `shapeValid`, `package.json` `test:perf`, test `d1/{batch-queries,_count,remind-load}`, `perf/background`, `P-a/pf1/thread.int.test.ts:485`. Trần: spec 25462/25600 · plan 30708/30720 · test-plan 30431/30720 (đạt, sát — sửa vào phụ lục/spec-ca, không vào spec/plan).

Đóng điều kiện Gate: D0a (ADR-0017 Accepted, điều kiện #190 ⇒ T9, có PD-P10), D0b (CR-081 Xong), D0c (mockup 01–04 duyệt).

#### Cao (sửa trước T6b — `UnitOfWork` thiết kế ở T6b, security review T6c)
| # | Vấn đề | Mặc định (theo CR-093 người dùng chốt, mới hơn spec-ca) |
|---|---|---|
| 81 | A10 "một tx mỗi lô" scope system nhiều tenant ↔ spec-ca CA-R06 ("mỗi hàng … `UnitOfWork.system(tenantId)`"), spec-ca:54 + plan K1 ("repo luôn nhận `tenantId` từ UoW"), plan:67 port từng hàng (`dueReminders`, `markReminded`), plan §4.9/§5 vòng từng hàng, K3 "`tenant_id = $t`"; A10 `runsFinished(tx, ids)` truyền `Tx` (trái K1). Chia theo tenant thì PD-P15 ≤ 6 câu không đạt (thêm câu đọc ứng viên) | Thêm `UnitOfWork.systemBatch(fn)` (scope system, chỉ vòng nền theo tập); repo lô nhận/trả hàng mang `tenant_id`: `ReviewTaskRepo.{claimDueReminders(limit,now), markRemindedMany(rows), claimDueEscalations(limit,now)}`, `NoticeWriter.insertMany`, `RunRepo.claimExpired(limit,now)`, `Notifier.runsFinished(ids)` (không `Tx`). K3 viết lại cho lô: mọi join khớp `tenant_id` của hàng nguồn, insert lấy `tenant_id` từ hàng nguồn, khoá `FOR UPDATE SKIP LOCKED` theo `(id, tenant_id)`; test 2 tenant cùng lô (AC-H46). CA-R06 thêm ngoại lệ "vòng nền theo tập (CR-093)". T6c review cả `systemBatch` |
| 82 | A10 "p95 ≤ 50 ms … đo riêng phần DB, Redis ghi kèm" ↔ PD-P13/P14 đo **cả lời gọi** `remindOnce`/`sweepOnce` (gồm phát Redis, và phần hẹn giờ/quét orphan của `sweepOnce`); "20.000 run ≤ 12 s" là tổng các lời gọi liên tiếp (không tính nhịp 3 s) — A10 không nói | Theo test khoá (chặt hơn, qc sở hữu): đo cả lời gọi; 10.000/20.000 = tổng lời gọi liên tiếp tới khi trả 0. Sửa câu A10 |

#### Tranh chấp qc (test-plan-addendum §3) — đều Thấp, test đang theo đúng mặc định
| TC | Tranh chấp | Mặc định (nguồn) |
|---|---|---|
| 1 | PD-I28 hậu tố `:2` | `:1` — PD-R10 (`n` = số hẹn cùng kind + 1; ca (a) PD-I26 có 0 hẹn). Sửa test-plan-int:39 |
| 2 | def `pd-wait-field` cần `ttl_days:30` | `ttl_days:30` (ttl 7 ⇒ hạn 2026-11-08 < `due_at` 11-17 ⇒ `timer_invalid`, PD-I26b). Thêm vào fixture test-plan §2 |
| 3 | PD-I42 không có cột `details` | `summary {from_group,to_group}`, `actor_id` NULL (`hub.audit_log` chỉ có `before/after/summary`; code: `launcher-step.ts:111`). Sửa plan §4.9 + test-plan-int:57 |
| 4 | PD-I39b chỉ một thứ tự | "huỷ XOR bắn": quay lại trước ⇒ `cancelled_at`, 0 output; bắn trước ⇒ `fired_at` + output rồi bị reset (đối xứng hàng retry∥huỷ plan §6). Thêm hàng plan §6, sửa test-plan-int:50 |
| 5 | PD-I39d/PD-P01 250/1.000 job một user vs trần | Không giới hạn trong test (`maxConcurrentRuns` vắng ⇒ không trần, `app.ts:109`, H2b L1); `startPd` không đặt |
| 6 | PD-I05 hai decision mở cùng run | Cho phép, `view.decision` = cũ nhất (hành vi P-b2 PI-14, K05) |
| 7 | PD-I09 `permission_lost` không kiểm `retry_count` | Không kiểm (spec không có luật reset ở ca này). Sửa test-plan-int:16 "trừ `permission_lost`" |
| 8 | PD-U34 `date` required vắng ⇒ `[]`; PD-U35 suy từ contract | `[]` — code hiện có (`start-inputs.ts` `shapeValid` chỉ kiểm giá trị gửi lên). Sửa test-plan:86 |
| 9 | `FORCE_USE_CURRENT`/`AUTOFIX_REASONS` Set hay mảng | `ReadonlySet` (code `core/task.rules.ts:51`) |
| 10 | A8 `escalateIssues` ↔ `escalateStageIssues` | `escalateStageIssues` (plan-domain, plan §4.9:134) — = #74 |
| 11 | `processDefStageIssues` vắng `ctx` | Bỏ kiểm nguồn input, vẫn kiểm nguồn field (plan-contract:79) — không phải tranh chấp |
| 12 | `ProcessEditorContextSchema` nạp từ đâu | `@ai/contracts/hub-admin` (`packages/contracts/src/hub-admin/processes.ts`, cùng endpoint process-defs). Ghi file vào plan-contract §4 |
| 13 | Tên/chữ ký repo UoW | Theo test: `runs.lock(runId)`, `timers.lockById(id)` ⇒ `null` khi không thấy, `timers.markFired(id, now)`, `timers.cancelForRun(runId, "all", now)` (plan:67 có tên, thiếu tham số). Ghi vào plan-addendum |
| 14 | PD-P03 "≤ 100/lượt" lỗi thời | A9 thắng: một lượt xả nhiều lô; PD-P03 chỉ log ms/lượt. Sửa test-plan-int:120 |
| 15 | PD-A01 gọi depcruise qua bin | `tools/scripts/src/depcruise.ts` (= `bun run depcruise`, có sẵn). Sửa test-plan:111 |
| 16 | PD-P15 có tính `set_config` | Không tính (hạ tầng `withHubScope`, một câu/tx). **Bắt buộc** để ≤ 6 khả thi: ngân sách nhắc = khoá ứng viên 1 + update `unnest` 1 + người nhận 1 + insert notice 1 + unread 1 + ứng viên chuyển cấp 1 = 6 (một tx/lô, 0 chuyển cấp); tính `set_config` hoặc chia tx theo tenant ⇒ 7. Ghi vào A10 |
| 17 | PD-P12 "không `postThread` trong vòng" đo bằng `run_end.posted_at` NULL (`processLoops:false`) thay vì stub | Theo test (không có seam stub; đơn giản nhất). Sửa test-plan-addendum §2. Test khoá `P-a/pf1/thread.int:490` gọi `postThread` tường minh ⇒ vẫn xanh |
| 18 | PD-P15 đo lô 10/99 (lô 100 kéo lô rỗng sau A9), hết hạn tính chênh so lượt rỗng | Theo test ("không phụ thuộc số hàng" — A10). Ghi vào test-plan-addendum §2 |

#### Thấp khác (sửa khi BUILD)
83 Lệnh xong T9/T10 `bun run test:perf -- P-d`: bun lọc OR ⇒ chạy mọi test có `P-d` + mọi `.perf.int.test` của mốc khác; dùng `PERF=1 bun --env-file=.env.local --config=bunfig.perf.toml test tests/acceptance/P-d/perf/`; CLAUDE.md "test:perf không thuộc Lệnh xong" thêm ngoại lệ CR-093 · 84 A10 index `unread` "nếu chưa có": đã có `process_notices_unread_idx (user_id) WHERE read_at IS NULL` (0019:391) ⇒ không thêm DDL, thêm dòng bảng plan-db §6 · 85 cột Đọc T9/T10 thiếu `plan-addendum A9, A10` (gộp #76) · 86 ADR-0017 "ghi khi build T7" ⇒ T10 (A10) · 87 A9 ghi rõ handle `remindOnce` = một lượt xả (trả tổng), test PD-P10/P11 dựa vào đó · 88 A10 chưa nói chuyển cấp theo tập và lịch nhắc tính ở đâu (CTE `update` một câu ↔ "luật thuần trên mảng"): mặc định khoá → luật lớp 1 → `update … from unnest`; chuyển cấp claim-update một câu, khi có hàng thì assignee/audit/notice nhiều hàng · 89 `packages/db/src/hub-rls.int.test.ts` thêm `process_timers` ở T6 (ghi cột File) · còn mở từ lần 4: 71, 73, 74–80

#### Câu hỏi người dùng
Không có (mọi mục có mặc định từ CR-093/spec/plan/code; A10 người dùng đã chốt "lọc `tenant_id` tường minh").

#### Điều kiện Gate (ngoài spec)
1–2, 4 đạt (D0a–D0c). 3. Security review T6c (gồm `systemBatch` #81), T12, T20 — trong BUILD. 5. P-d2: ADR-0022 Accepted hoặc `/mcp` hiện có. 6. Báo ở Gate: vòng nhắc bật lần đầu nhắc ngay task cũ quá hạn; retry `parallel_merge` tốn token; NFR 50 ms đo cả lời gọi (#82) — số đo T3 hiện tại p95 441 ms (nhắc) / 1.676 ms (hết hạn).

Lần 6: docs-architect/backend-lead áp #81, #82 (+ TC/Thấp nếu tiện) vào plan-addendum/spec-ca ⇒ chạy lại chỉ diff.

### Lần 4 · 2026-10-17 · READY

Phạm vi: diff 4034d4f..40e6ca9 (17 file P-d-durable) + #54–#73; đối chiếu plan-contract:60–79, plan-domain:121–123, plan-addendum A2–A3/A8, plan-frontend:58/93/115, plan-frontend-i18n:62, `admin-web/.../StageGeneral.tsx:83`. Trần: spec 25584/25600 · plan 30708/30720 · plan-frontend 24826/25600 · test-plan 30423/30720 (đạt, sát).

Đóng: #54–#70, #72. Cao #55–#58 đã đóng (tasks:3 + cột Đọc; 400 qua API cho escalate ở auto; PD-U68 bốn ca; path WAIT phía contract theo A2/A8 + PD-C13/C15).

#### Thấp (sửa khi BUILD)
74 A8:168 `escalateIssues` ⇒ `escalateStageIssues` · 75 PD-C13/C15 thiếu path `stages.<i>.executor` (A8 nói 5 ca) · 76 Đọc T5/T9/T11 + A8 · 77 Đọc T15 + A1/A2/A7 · 78 Đọc T4 "lần 3" cũ · 79 plan-frontend-d2 ô timeout_s dùng lại `process.admin.editor.stage.timeout`, ẩn budget · 80 câu i18n ESCALATE_INVALID (vô hại) · 71 trùng nhãn A (giữ tiền tố) · 73 trần sát

#### Câu hỏi người dùng
Không có.

#### Điều kiện Gate (ngoài spec)
1. ADR-0017 Accepted (chờ staging: Redis thật + tải 10.000 run). 2. Người dùng duyệt `mockup/01–04`. 3. Security review T6c, T12, T20. 4. CR-081 đóng. 5. P-d2: ADR-0022 Accepted hoặc dùng `/mcp` hiện có. 6. Báo ở Gate: vòng nhắc bật lần đầu nhắc ngay task cũ quá hạn; retry `parallel_merge` tốn token.

Spec/plan/tasks đổi sau lần này (kể cả khi sửa #74–#80) ⇒ T4 chạy lại readiness, chỉ kiểm diff.

### Lần 3 · 2026-10-17 · NOT READY

Phạm vi: diff 6f50f67..40055fd (spec, spec-ac/ca/d2/decisions/tz-tools, tasks, test-plan*, BA-admin AC-A14, INDEX) + plan-addendum A1–A7; đối chiếu plan-contract §3/§6, plan-domain:65/115–119, plan-d2 §1–§4, plan-frontend §6/§14–§15, plan-frontend-d2, i18n; code `hub-admin/processes.ts:154`, `common.ts:64-68`, `core/handles.ts:4`, `mcp.service.ts:185,258`, `hub-scope.ts:21`, loader test khoá A6/K30. Trần: spec 25592/25600 · plan 30708/30720 · plan-frontend 25541/25600 · test-plan 30303/30720 (đạt, rất sát).

#### Cao
| # | Vấn đề | Mặc định |
|---|---|---|
| 55 | plan-addendum không được trỏ từ tasks.md (cột Đọc) và từ các mục bị thay | dòng "plan-addendum thắng" đầu tasks + cột Đọc theo task + "→ thay bởi plan-addendum Ax" ở từng mục |
| 56 | `escalate` ở stage `auto` ⇒ 422 (PD-R23, AC-H42, PD-I47b) ↔ contract `after.auto` strict ⇒ 400 | 400 qua API; ESCALATE_INVALID chỉ bắt ở bản nháp FE |
| 57 | PD-U68 `afterH` sai ⇒ `[]` ↔ plan-domain:119 ⇒ ESCALATE_INVALID | theo plan-domain; API vẫn 400 (zod) |
| 58 | path WAIT phía contract (plan-contract:79) ↔ plan-addendum A2; PD-C13 cho WAIT chạy qua hàm tool/branch | A2 áp cả phía contract; PD-C13 dùng `processDefStageIssues`; ca path WAIT ở `contracts-pd1` |

#### Thấp
59 spec §9 câu ADR-0017 cũ · 60 spec-ca run-access "import từ domain" · 61 `DECISION_OPTIONS`↔`DECISION_OPTION_ORDER` · 62 test A1 params 50 · 63 PD-E04 "hoặc" · 64 PD2-I06 `base_url` qua cache catalog · 65 PD-I75 ép 40P01 · 66 "PD-C08-nối tiếp" ⇒ PD-C14 · 67 Q-D2-4/5 cũ · 68 spec-d2 §4 catalog ⇒ D-PD11 · 69 plan-frontend-d2 ô ẩn của tool theo A3 · 70 PD-I36 `timeout_s` · 71 trùng nhãn A1–A7 · 72 T4 tên lần 2 · 73 trần sát · 54 FE Q1/Q3/Q4 (mặc định)

#### Câu hỏi người dùng
Không có.

#### Điều kiện Gate (ngoài spec)
1. ADR-0017 Accepted (chờ staging: Redis thật + tải 10.000 run). 2. Người dùng duyệt `mockup/01–04`. 3. Security review T6c, T12, T20. 4. CR-081 đóng. 5. P-d2: ADR-0022 Accepted hoặc dùng cách gọi `/mcp` hiện có. 6. Báo ở Gate: vòng nhắc bật lần đầu nhắc ngay task cũ quá hạn; retry `parallel_merge` tốn token.

Lần chạy 4: chỉ diff sau khi áp #55–#73.

### Lần 2 · 2026-10-17 · NOT READY

Phạm vi: diff 8c0b473..5cfae09 thư mục spec + plan, plan-contract, plan-db, plan-domain, plan-d2, plan-frontend(-d2,-i18n), mockup 01–04, test-plan(-rules,-int,-d2,-e2e), ADR-0023; đối chiếu `common.ts:210`, `audit.ts`, `mcp.repo.ts:75`, CHECK audit hub 0029/0030, import của `ask/notify/back/step/task/run-access/autofix.rules.ts`. Trần: spec 24923/25600 · plan 30708/30720 · plan-frontend 25541/25600 · test-plan 30571/30720 (đạt, sát).

#### Chặn
| # | Vấn đề | Mặc định |
|---|---|---|
| 33 | `VALIDATION_ERROR` 422 (spec/BA) ↔ 400 (contract) | 400, sửa spec/BA |
| 34 | side_effect: type 'workflow' ↔ 'tool'; cột `retry_since/retry_attempt/retry_round` chưa vào spec | theo D-PD03/D2-03 |
| 35 | file đích task lệch (step.rules, run-status, T7s, task-access, thiếu T18s, chia T7/T8/T18) | theo plan-domain §7 / plan-d2 §8–9 |
| 36 | ADR-0017 Proposed (điều kiện Gate) | hỏi người dùng |

#### Cao
37 import contract trong file dời vào domain (run-access, autofix, `FORWARD_CHAIN_MAX`, `DECISION_OPTIONS`) · 38 e2e lệch nhãn FE · 39 G1–G7 (contract FE cần) · 40 PD-R23 ngưỡng ⇒ 400 · 41 audit `workflow` + `grant`/`revoke` · 42 quyết định plan chưa vào spec · 43 retry team `lead_plan`/`parallel_merge` · 44 spec-ac §2 ⇒ trỏ test-plan §6 (+K30) · 45 T10 → rủi ro cao · 46 chữ ký `teamResumePlan`

#### Thấp
47 câu Q4/Q6/Q9/Q10/Q-D2-1…3 của qc · 48 Lệnh xong T5/T11/T12/T20 (+`test:all`) · 49 trạng thái cũ · 50 "nếu backend-lead thấy cần" · 51 ép `answerer`/`timeout_s` · 52 câu PD-R02 · 53 trần sát (sửa vào phụ lục) · 54 FE Q1–Q4

#### Câu hỏi người dùng
1. ADR-0017: chờ staging (mặc định) hay Accept dựa trên spike local + PD-P01/P02? → **Người dùng trả lời 2026-10-17: chờ staging.** Gate P-d1 chỉ khi ADR-0017 Accepted sau spike Redis thật + tải 10.000 run trên staging (dựng staging, deploy là việc ra ngoài — hỏi người dùng trước).

Báo người dùng ở Gate (không hỏi): vòng nhắc production bật lần đầu sẽ nhắc ngay các task cũ quá hạn; retry `parallel_merge` gọi lại cả lượt (tốn token).

Lần chạy 3: chỉ diff sau khi docs-architect / backend-lead / qc áp #33–#54 (a).

### Lần 1 · 2026-10-17 · NOT READY

Phạm vi: 6/6 file spec, CLAUDE.md, WORKFLOW, BA §6.10 / BR-12, 25, 26, 38, 41–43 / §8 / §11, CR-083…087, ADR-0017; đối chiếu `chat/processes.ts`, `processes-entities.ts`, `hub-admin/processes.ts`, `process-steps.ts`, `hub/errors.ts`, `db/schema/hub-processes.ts`, `hub.ts`, `admin.ts`, `migrations-hub/0019`, `runs/sweeps.ts`, `executor-ref.ts`, `notify/reminder.ts`, `core/task.rules.ts`, `mcp/mcp.service.ts`.

#### Lỗ hổng Chặn
| # | Vấn đề | Mặc định đề xuất |
|---|---|---|
| 1 | Chưa có `plan.md`, `plan-frontend.md`, `test-plan.md`; contract còn dời sang plan | Chạy T1 (BE), T2 (FE), T3 (qc), rồi readiness lần 2 chỉ kiểm phần đổi |
| 2 | Chưa có mockup, câu chữ VI/EN, trạng thái tải/rỗng/lỗi, nhãn e2e | frontend-lead dựng mockup artifact panel stage + nhãn chat trong T2, trình cùng Gate |
| 3 | Phân loại lỗi đọc được hai cách (6 lý do job chưa xếp loại; code ↔ reason mâu thuẫn; `provider_state` toàn cục; lỗi mạng giả định) | Hàm thuần `classifyJobError(code, reason)`: xét `error_reason` trước (tạm = timeout, upstream, crash, orphaned, provider_busy, tenant_slots); reason null thì tạm = `TIMEOUT`, `UPSTREAM_ERROR`; `ALL_PROVIDERS_EXHAUSTED` tạm chỉ khi reason ∈ provider_busy/tenant_slots; còn lại nghiệp vụ; `interrupted` = tạm; không đọc `provider_state` |
| 4 | "Đã gửi side_effect" chưa rõ nguồn cờ, phạm vi, trạng thái | Có `hub.run_steps` type=`workflow`, status ≠ `skipped`, thuộc `hub.runs` có `stage_run_id` = stage, tạo từ đầu attempt/round hiện tại, `admin.workflows.side_effect=true` |
| 5 | Stage team: PD-R03 ↔ PD-R08 mâu thuẫn khi retry bắn | Mức thành viên: team-run giữ `running`, dừng tính `active_ms`; bắn thì gọi lại thành viên ở `cursor`, không tăng `calls`; khoá idempotency theo `stage_run_id` |
| 6 | Quyền gọi tool không có mô hình (`admin.workflows` không có `tenant_id`; stage tool không có agent) | Tool khả dụng = workflow `enabled` gắn ≥ 1 agent đã bật cho tenant mà người bắt đầu có grant; lưu kiểm theo tenant, chạy kiểm theo người bắt đầu; tool của gói để sau |

#### Lỗ hổng Cao
| # | Vấn đề | Mặc định đề xuất |
|---|---|---|
| 7 | Trường bắt buộc của stage chưa định nghĩa cho `wait_until`/`tool` | `wait_until`: ép `required_sections=["Bàn giao"]`, template cố định, `fields=[]`, `answerer=starter`, `token_budget=null`, bỏ `timeout_s`. `tool`: ép `["Kết quả","Bàn giao"]` + template nguyên văn, bỏ `answerer` |
| 8 | `ExecutorRef` chưa có dạng cho executor mới | Theo `APPLY_EXECUTOR_REF`: wait_until key `wait_until`, name "Chờ tới ngày"/"Wait until date"; tool key = `tool_key`, name = tên workflow |
| 9 | `idempotency_key` va chạm sau `add_attempt` | Thêm hậu tố `:<n>` (số hẹn giờ cùng kind của stage_run + 1) tính dưới khoá run |
| 10 | Thứ tự khoá timer ↔ run ngược nhau, có thể deadlock | Đọc ứng viên không khoá; mỗi hàng một tx: khoá run → `SELECT … FOR UPDATE` timer → áp hiệu ứng; mọi đường run → stage → timer |
| 11 | "FORCE RLS" sai so với 0019 | ENABLE, không FORCE; policy `process_timers_hub_rw` theo tenant như 0019 |
| 12 | Thiếu nới CHECK audit, loại tin thread, `HistoryItem.kind` | Thêm cuối: audit `escalate`, `escalate_skipped` (0036), `tool_call`, `branch` (0037); `ROOM_PROCESS_KINDS` + `branch`; `HistoryItem.kind` + `escalate`, `branch` |
| 13 | `ESCALATE_INVALID`/`TOOL_INVALID` ↔ `PROCESS_REF_INVALID` | Không tồn tại / khác tenant ⇒ 422 `PROCESS_REF_INVALID`; lỗi cấu hình khác ⇒ `PROCESS_DEF_INVALID` rules[] |
| 14 | `use_current` của `timer_invalid` mâu thuẫn `decisionOptionsFor` | Thêm `timer_invalid` vào `FORCE_USE_CURRENT`; Hub ghi .md "Bỏ chờ theo quyết định"; người quyết như `agent_failed`; `tool_failed` chỉ `use_current` khi có output |
| 15 | "Bước trước" chưa rõ | Mọi bước nhỏ hơn; nguồn `skipped`/không output ⇒ `timer_invalid` / `tool_failed` |
| 16 | Chưa có hình value của input `date` | `{key,type:'date',value}`, `^\d{4}-\d{2}-\d{2}$` + ngày lịch hợp lệ; sai ⇒ 422 `VALIDATION_ERROR` |
| 17 | AC-H41 trái trần 5 run | "4 running + 1 waiting_timer ⇒ bắt đầu được; 5 running + 1 waiting_timer ⇒ chặn" |
| 18 | ADR-0017/0018/0022 còn Proposed | Gate P-d1 chỉ cần ADR-0017 Accepted; P-d2 (T16) cần ADR-0022 Accepted hoặc dùng cách gọi workflow hiện có |
| 19 | D7 "múi giờ theo tenant" ↔ spec dùng hằng | Hỏi người dùng (câu 2) |

#### Vừa / Thấp (xử lý trong plan, không chặn)
#20 thứ tự ưu tiên trạng thái run khi có `waiting_timer`; #21 `remind_count`/`reminded_at` khi không cấu hình, độ trễ ≤ 5 phút; #22 bổ sung test khoá (`contracts-pa.test.ts:175`, `P-b/pfs3/rules/sources.rules.test.ts`, `P-a/pf1/start.int.test.ts`); #23 import/export `ttl_days`; #24 regex `time`, câu .md nguyên văn; #25 sửa tham chiếu `gates/forward*` trong tasks; #26 ghi `hub.runs`/`run_steps`/`usage_logs` cho tool ngoài job; #27 BA ghi "AC-H38 giữ chỗ (X2b2)"; #28 frontmatter thêm ADM-FR-71, CHAT-AC-59; #29 AC-H45 đánh số bước; #30 `DATE_RE` kiểm ngày lịch; #31 migration 0036/0037 hợp lệ; #32 kích thước đạt.

#### Mâu thuẫn giữa tài liệu
- ADR-0017:32 "thử lại tới `attempt_limit`" ↔ D3 `retry_count` riêng → giữ D3, sửa ADR khi Accepted.
- D7/CR-084/HUB-FR-144 "múi giờ theo tenant" ↔ spec dùng hằng → hỏi người dùng.
- spec.md:130 FORCE ↔ 0019 không FORCE → theo 0019.
- `ESCALATE_INVALID` ↔ `PROCESS_REF_INVALID` → theo #13.
- AC-H41 ↔ trần 5 run → sửa câu AC.
- PD-R14 `use_current` ↔ `decisionOptionsFor` → theo #14.

#### Câu hỏi cho người dùng (một lượt)
1. Chấp nhận trọn gói mặc định A1–A12, Q1 theo #5, Q2 theo #3, Q4–Q7, và #4, #7–#18, #20–#26?
2. GĐ1 dùng hằng `Asia/Ho_Chi_Minh`, cột múi giờ theo tenant để giai đoạn sau?
3. Quyền gọi tool (P-d2): theo #6, hay thêm công tắc bật tool theo tenant trong Admin?
4. Mockup: frontend-lead tự dựng trong T2 và duyệt ở Gate, hay người dùng cung cấp?

Lần chạy 2: chỉ kiểm diff thư mục spec cùng plan/plan-frontend/test-plan mới và các mục #1–#26 còn mở.

> 2026-10-17 · Đã áp trả lời người dùng, chờ T1–T3 rồi readiness lần 2.
> 2026-10-17 · Áp ADR-0023 (CR-088…091): thêm [`spec-ca.md`](spec-ca.md), task T3a/T6b/T6c/T7s…T19s trong `tasks.md`; chờ T1–T3 rồi readiness lần 2 (kiểm cả phần đặt code theo lớp).

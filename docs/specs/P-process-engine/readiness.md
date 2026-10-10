# Readiness · P-process-engine

Mỗi lần chạy spec-readiness thêm một dòng (mới nhất ở trên). Báo cáo đầy đủ dán bên dưới dòng đó hoặc lưu file riêng. Chạy cho **P-a** sau khi có plan + test-plan (tasks P1, P2, Q1); M1–M6 (spec §9) cần xác nhận ở lần chạy đầu.

| Ngày | Kết quả | Chặn | Cao | Thấp | Ghi chú |
|---|---|---|---|---|---|
| 2026-10-10 (lần 1, `db3e7021`) | NOT READY | 1 | 7 | 9 | + 7 Trung bình. Chặn = ai mở task hỏi lại (PF1 hay PF2). 4 mục cần người dùng quyết (U1–U4), còn lại đội tự sửa theo Luật 2 |
| (chưa chạy) | — | — | — | — | Spec draft 2026-10-09 (CR-056…058) |

---

## Lần 1 · 2026-10-10 · commit `db3e7021`

## Kết luận: NOT READY
Phạm vi đã kiểm: `docs/specs/P-process-engine/` · 13 file (spec, plan, plan-contract, plan-seed, plan-frontend, -admin, -i18n, -e2e, test-plan, -int, -e2e, tasks, spike) + CLAUDE.md, WORKFLOW.md (Kỷ luật token #5, "Làm song song nhiều session" CR-059), BA-H §6.10/§8/§11, usecases-chat UC-12, ba-admin §5.8, CR-056 · mã yêu cầu: HUB-FR-104…117 (vế P-a), HUB-BR-23…28, AC-H28…H34, CHAT-AC-51…58, ADM-FR-65…67

Trần kích thước (`wc -c`, 1 KB = 1024 B): spec 21 077 / 25 600 · plan 30 480 / 30 720 (còn 240 B) · plan-frontend 25 468 / 25 600 · test-plan 23 360 / 30 720 → **đạt**. Phụ lục không có trần.

## Lỗ hổng
| # | Mức | Mục | Vị trí (file:dòng hoặc mã) | Vấn đề | Mặc định đề xuất |
|---|-----|-----|----------------------------|--------|------------------|
| 1 | Chặn | H, I (CR-059) | plan.md:93 (§4 "Hỏi lại ≤ 3 … `runs/stage-driver.ts`"), :74 (§3.2), plan-contract.md:108 (`Effect "open_ask"`), :132 (`mergeQuestions` ở `runs/team.rules.ts` PF1), :141 (`askExcerpt` ở `asks/ask.rules.ts` PF2) ↔ tasks.md:40 (B6b "need_input → task ask, gộp câu hỏi nhóm" ở `asks/**` PF2) ↔ test-plan.md:184 (N2 "stage-driver gọi port asks" — port này không có trong plan.md:137) | Hai cách hiểu ai mở task `ask`; theo B6b thì PF1 cần file PF2 (`askExcerpt`) hoặc một port không tồn tại | **PF1 mở task ask**: `stage-driver`/`team-runner` thực thi hiệu ứng `open_ask` bằng `core.insertTask` (Bước 0) + gọi `ProcessNotifier`; chuyển `askExcerpt` sang `core/` (Bước 0, test R-AK04 sang `step0/rules`); `mergeQuestions` giữ PF1. B6b chỉ còn trả lời + chuyển + `kick`. Sửa: backend-lead (plan §9, tasks B4/B5/B6b), qc (R-AK04, P2-01/10/11 ghi ⇢PF1 hoặc chuyển sang pf1) |
| 2 | Cao | B, D | plan.md:84 (§3.4 task `decision` — không ghi assignee), plan-contract.md:37–38 (`TaskDetail` không có `options`/output; view `task` không có `decision`), test-plan.md:196 (Q2), test-plan-int.md:71 (P1-44 T `decide` = 200), test-plan.md:124 (R-K04) | Không biết ai là assignee của task `decision` (ảnh hưởng "Chờ tôi kiểm", notice `decision_requested`, quyền xem). T ngoài phòng được quyết (Q2) nhưng view `task` không có dữ liệu cho `DecisionCard` (plan-frontend.md:50 đọc `decision.options`) | Assignee task `decision` = người bắt đầu (hàng user) + Group duyệt **chỉ khi** lý do `redo_limit`; `tenant_admin` không là assignee (thấy qua Evolu Control). `TaskDetail` kind `decision` thêm `options: DECISION_OPTION[]`, `has_output: bool`; `DecisionCard` dựng từ `TaskDetail` khi `access:task`. Sửa: backend-lead (plan §3.4, plan-contract §2), frontend-lead (plan-frontend §3), qc (R-K04 giữ, thêm ca view `task` có decision task) |
| 3 | Cao | H (CR-059) | plan.md:122, :131 (core Bước 0 chỉ có `lockRun`, `loadRunHead`, `insertTask`, `closeTask`) ↔ plan-contract.md:53, :59–61, :58 (PF1 view, PF2 answer/forward, PF3 `/me/review-tasks` đều trả `TaskDetail` + `can_act`) | Bộ dựng `TaskDetail` + luật `can_act` dùng bởi 3 PF nhưng không nằm ở Bước 0 ⇒ mỗi PF tự viết, dễ lệch quyền | Thêm `core/task-view.ts` (`toTaskDetail`, `canAct`) vào Bước 0 (B0) + test luật ở `step0/rules`. Sửa: backend-lead (plan §8–§9, tasks B0), qc |
| 4 | Cao | H (CR-059) | plan-frontend.md:71 (`RunPage` PF3 dùng `CancelRunButton`, `DecisionCard`), :104 (danh sách stub Bước 0 thiếu `CancelRunButton`), :120 (`CancelRunButton` thuộc PF1) | PF3 cần file của PF1 chưa có stub; nhánh PF3 tạo từ `main` sau Bước 0 sẽ không biên dịch | Thêm `CancelRunButton` vào stub Bước 0 (§9 #1) hoặc chuyển vào `shared/`. Sửa: frontend-lead |
| 5 | Cao | F (CR-059 cổng merge) | test-plan.md:15–16 ("Cổng merge: toàn bộ `P-a/**`"), :13 (scenario "từ cổng merge PF2"), test-plan-e2e.md:29 (E-P13 kiểm tab Token bản summary — PF4), :35–36 (E-S1/E-S2 Token khớp, "tab Token 8 hàng" — PF4), test-plan-int.md:151 (SC-1 usage) | Với thứ tự merge PF1 → PF3 → PF2 → PF4, cổng merge PF1/PF3/PF2 không thể xanh (thư mục pf2–pf4 + scenario cần PF4) — mâu thuẫn WORKFLOW "Cổng merge" bước 2 | Cổng merge nhánh k = `step0` + pf của các nhánh đã merge + pf của nhánh k; `scenario/` chỉ chạy từ cổng merge PF4 + `done:pa`. Chuyển phần Token của E-P13 sang pf4 (E-P14b: T thấy `summary`). Sửa: qc (test-plan §1, test-plan-e2e) |
| 6 | Cao | F, J | test-plan.md:185–186 (N3, N4) ↔ plan.md §9 (không có) | Test viết trước cần symbol thật: `sweepOnce`, `remindOnce`, deps `createApp` (`processEngine`, `processRunsPerTenant`, `stageLauncher`, `now`), payload job stage (`process_run_id`, `stage_run_id`, `team_run_id`, `step_id`, `files`, `timeoutS`), `run_steps` cho lần gọi nhóm | Ghi đúng mặc định N3/N4 của qc thành chữ ký ở plan-contract §7 (plan.md chỉ còn 240 B) + stub B0. Sửa: backend-lead |
| 7 | Cao | F, I (bảo mật) | spec.md:163 (C2 đã chấp nhận), plan.md:10 (D3) ↔ BA-H HUB-BR-23 ("`agent_grants` của người bắt đầu" cho **mọi** lần gọi); test-plan-int §2 (không có ca C2), plan-contract.md:153 (ma trận security không có C2) | Quyết định bảo mật đã duyệt nhưng không có test và BA vẫn ghi ngược lại | qc thêm P1-36: stage nhóm, A không có grant agent thành viên ⇒ vẫn chạy; nhóm bị thu entitlement / thành viên tắt lúc `kick` ⇒ needs_decision `permission_lost`; thêm dòng C2 vào ma trận RV1. docs-architect ghi ngoại lệ C2 vào HUB-BR-23 |
| 8 | Cao | A | ba-admin ADM-FR-65, BA-H HUB-FR-104 ("Export/Import JSON qua Import/Export sẵn có", MUST P-a), spec.md:134 ↔ plan/plan-contract/tasks/test-plan (không có) | Yêu cầu MUST P-a không có contract, task, test | **Người dùng quyết (U2)** — mặc định: dời sang P-b, ghi vào spec §1 "Không làm ở P-a" + tag BA |
| 9 | Trung bình | I | tasks.md:26 (B3 "nhóm `ba-team` + 4 agent BA"), plan.md:124 (`agents.yaml` (+4 agent)) ↔ plan-seed.md:19–20, :32 (8 agent vai + `plan-team`/`dev-team`/`test-team`) | Seed lệch giữa task và D18 | Sửa B3 + plan §8 hàng 0c: "8 agent vai + 3 nhóm + giữ `ba-team` (xem plan-seed)". Sửa: backend-lead |
| 10 | Trung bình | H (CR-059) | tasks.md:52 (B8 "+ seed usage dev", File chỉ `processes/usage/**`) | Seed thuộc file Bước 0 (B3) | Bỏ seed usage khỏi B8 (test dùng fixture SQL) hoặc đưa vào B3. Sửa: backend-lead |
| 11 | Trung bình | H | plan-frontend.md:113 (`tools/scripts/src/i18n-check.ts` "ngoài phạm vi frontend-lead") ↔ tasks.md:25 (B0 File không có) | Việc không có chủ | Thêm `tools/scripts/src/i18n-check.ts` vào cột File của B0. Sửa: điều phối (tasks.md) |
| 12 | Trung bình | H | tasks.md:24 (B2 = 0a phụ thuộc B1) ↔ tasks.md:14, plan.md:120, WORKFLOW "0a contract + mock (FE bắt đầu ngay)" | Thứ tự 0a/0b ngược | B2 phụ thuộc QC1; B1 phụ thuộc QC1 (song song B2); B0 phụ thuộc B1+B2. Sửa: điều phối |
| 13 | Trung bình | G | plan.md:120 (mock "cho cả 4 PF"), test-plan.md:187 (N5), plan-frontend.md:133 (#3) | Nội dung mock B2 (persona, id cố định, cổng điều khiển) chưa chốt | Ghi danh sách N5 (6 trạng thái run, 3 notice, usage full/summary, persona A/B/T/H/Adm, `POST /__mock/control`) vào tasks B2. Sửa: backend-lead |
| 14 | Trung bình | I | spec.md:122 (Q4 người dùng chốt "Trưởng nhóm lập kế hoạch"), BA-H HUB-FR-114, AC-H35 ↔ spec.md:153, plan.md:14 (D7 mặc định `sequential` theo spike) | Spike đổi một quyết định người dùng đã chốt | **Người dùng xác nhận (U3)** — mặc định `sequential`, `lead_plan` vẫn chọn được; docs-architect cập nhật Q4/HUB-FR-114/AC-H35 |
| 15 | Trung bình | H | tasks.md:24 (B2 Rủi ro `thường`) | B2 định nghĩa schema `ProcessRunView` access `task` strict (chốt chống rò, R-K04) — chạm quyền | Đổi B2 sang `cao`. Sửa: điều phối |
| 16 | Thấp | F | test-plan-e2e.md:28 (E-P12 bấm Đạt trong DM dùng `ReviewTaskCard` PF1) | Không đánh dấu ⇢PF1 | Ghi ⇢PF1. Sửa: qc |
| 17 | Thấp | D, J | spec.md:74–75, :177; plan.md:91, :98 ("~7 ngày", "~5") | Từ mơ hồ (giá trị thật ở plan-contract.md:9–10) | Ghi "7 ngày (`PROCESS_RUN_TTL_DAYS`)", "5 (`PROCESS_RUNS_PER_TENANT`)". Sửa: docs-architect / backend-lead |
| 18 | Thấp | I | spec.md:43 ("X2b-2 → spike P → P-a") ↔ spec.md:126 (Q8 2026-10-10: P-a trước X2b-2) | Thứ tự mốc lệch | Sửa dòng 43 theo Q8. Sửa: docs-architect |
| 19 | Thấp | I | BA-H §8 `review_tasks` (`assignee_user_id`, `forward_chain` jsonb, kind review\|ask) ↔ plan.md:37–38 (`review_task_assignees`, kind + `decision`) | Mô hình BA cũ | docs-architect ghi "chốt ở plan P-a §2". |
| 20 | Thấp | E | ba-admin ADM-FR-65 (cột "Group được chạy", "run gần nhất") ↔ plan-frontend-admin.md:10, :45 | "run gần nhất" không có, không ghi trong bảng lệch | Thêm vào plan-frontend-admin §3 (P-b). Sửa: frontend-lead |
| 21 | Thấp | I | usecases-chat CHAT-AC-58 ("người duyệt" thấy token theo lần gọi) ↔ spec.md:166 (C5 đã chấp nhận: ngoài phòng chỉ tổng) | AC chưa ghi C5 | docs-architect ghi chú C5 vào CHAT-AC-58 (cùng lượt sửa F4) |
| 22 | Thấp | C (bảo mật) | plan.md:39 (`process_notices` INSERT theo tenant) | Mọi user cùng tenant ghi được notice cho người khác ở tầng RLS (chỉ code app chặn) | Giữ; RV1 kiểm không có route nào cho user tự chèn notice. Sửa: reviewer |
| 23 | Thấp | H | tasks.md (không có cột "Feature/nhánh"; dùng tiêu đề mục) | WORKFLOW CR-059 yêu cầu cột | Chấp nhận tiêu đề mục làm cột; hoặc thêm cột. Điều phối |
| 24 | Thấp | I | plan.md 30 480 B | Còn 240 B tới trần | Mọi bổ sung (#1–#3, #6) ghi vào plan-contract.md hoặc phụ lục mới `plan-pf.md` |

## Mâu thuẫn giữa tài liệu
- plan §4/§3.2 + contract §7 (PF1 mở ask) ↔ tasks B6b (PF2) ↔ test-plan N2 (port không tồn tại) → giữ **PF1** (#1).
- UC-12 CHAT-AC-52 "thread hiện từng stage" + BA-H HUB-FR-113 "(trong thread)" + mockup ④ ↔ plan D13 / plan-frontend FD5 (thẻ + pane, không thread) → giữ plan; người dùng xác nhận F4 (U1), docs-architect sửa AC-52 + FR-113.
- BA-H HUB-BR-23 (grant mọi lần gọi) ↔ spec C2 (đã chấp nhận) → giữ C2, ghi ngoại lệ vào BA (#7).
- spec Q4 / BA HUB-FR-114 / AC-H35 (lead_plan mặc định) ↔ plan D7 (sequential) → xác nhận U3 (#14).
- plan-seed D18 (sdlc 8 giai đoạn, 8 agent vai, 3 nhóm) ↔ tasks B3 + plan §8 "+4 agent BA" → giữ D18 (#9). "5 stage" không còn ở spec/plan/test-plan (đã kiểm), CR-056/ROADMAP không ghi số giai đoạn.
- spec §1 thứ tự mốc ↔ Q8 → giữ Q8 (#18).
- BA §8 `review_tasks` ↔ plan §2 → giữ plan (#19).

## Câu hỏi cho người dùng (chỉ những gì KHÔNG có mặc định an toàn)
1. **U1 · F1–F4** (plan-frontend §11): F1 khởi chạy chưa nhận tệp đính kèm ở P-a (hoá đơn mẫu dùng văn bản) · F2 "Chờ tôi kiểm" luôn hiện khi bật · F3 KPI + chuỗi giai đoạn danh sách admin dời P-b · F4 bỏ thread, dùng thẻ run + pane (sửa CHAT-AC-52, HUB-FR-113, lệch mockup ④). Mặc định: **chấp nhận cả 4**.
2. **U2 · Import/Export JSON quy trình** (ADM-FR-65, HUB-FR-104 MUST P-a; chưa có trong plan/task/test). Mặc định: **dời P-b** (giống F3).
3. **U3 · Chế độ nhóm mặc định** — spike đổi Q4 từ "Trưởng nhóm lập kế hoạch" sang `sequential`. Mặc định: **`sequential`**, `lead_plan` vẫn chọn được.
4. **U4 · Xác nhận M1–M6** (Luật 2 ở spec §9, chưa được người dùng duyệt), hai điểm bảo mật: M4 — người ngoài phòng xem lại phần task của mình **không hết hạn** sau khi run kết thúc; M5/Q2 — thành viên Group duyệt ngoài phòng được "Cần người quyết" khi lý do `redo_limit` (chạy tiếp bằng quota người bắt đầu). Mặc định: **chấp nhận như spec**.

Đội tự đóng theo Luật 2 (ghi vào spec §9 / test-plan): QC Q1, Q3–Q7 (khớp contract §3, BA-BR-24, HUB-FR-104); N1, N6, N7; yêu cầu backend của plan-frontend #1 `process_key`, #2 `open_count`, #4 `StageView.sections` (đều giữ mặc định: lọc client, "50+", P-b).

## Checklist
| Mục | Kết quả | Bằng chứng (file:dòng / mã) |
|-----|---------|-----------------------------|
| A Phạm vi | Thiếu | spec.md:35–45 (làm/không làm, mã); thiếu Import/Export ADM-FR-65 (#8) |
| B Hợp đồng | Thiếu | plan-contract.md §3–§6 đủ method/path/quyền/schema/mã lỗi/phân trang/409; thiếu assignee + dữ liệu task `decision` (#2) |
| C Dữ liệu | Đạt | plan.md:26–51 (bảng, cột, null/default, index, FK, RLS T, GRANT, CHECK audit), migration 0019; seed plan-seed.md |
| D Nghiệp vụ | Thiếu | plan.md §3 máy trạng thái, §4 giới hạn, §10 khoá; mơ hồ "~" (#17); ai quyết task decision (#2) |
| E UI | Đạt | plan-frontend.md §2–§8 (trạng thái tải/rỗng/lỗi/404), plan-frontend-i18n.md (VI/EN nguyên văn), plan-frontend-admin.md §3 lệch mockup; cần U1 cho F1–F4 |
| F Kiểm chứng | Thiếu | test-plan.md §3 phủ mọi mã P-a; thiếu ca C2 (#7), phạm vi cổng merge (#5), seam test (#6) |
| G Phụ thuộc & môi trường | Thiếu | spec.md:90–96 (fake-cli, mock Dify H2a), cờ `HUB_PROCESS_ENGINE` plan.md:22; nội dung mock B2 chưa chốt (#13) |
| H2 Vai trò | Đạt | spec §3–§5 trỏ plan/plan-frontend (không còn ô trống); chữ ký luật thuần plan-contract.md:94–150; test-plan có mọi FR MUST |
| H Task | Thiếu | tasks.md có File/Phụ thuộc/Lệnh xong/Rủi ro; lỗi #1, #9–#12, #15 |
| I Nhất quán | Mâu thuẫn | xem "Mâu thuẫn giữa tài liệu" |
| J Độ chính xác | Thiếu | symbol có sẵn đã Grep: `RunService.launch(…, {driver})` runs.service.ts:267, `createRunTx` create-run.ts:127, `withConfigWrite` studio-write.ts:32, `PROTECTED_PREFIXES` app.ts:90, `parseFields`, `routeRoomMessage`, `directOnSnapshot`, `runJob` job-agent-runner.ts:278, `done-x2b.ts`, FE `SuggestMenu`/`FlowFrame`/`PersonPicker`/`AskCard`/`NotFoundState`/`EditorSaveBar`/`ConflictEntity` — có thật; thiếu chữ ký seam (#6) |

## Quét từ mơ hồ
≈ 70 kết quả; phần lớn là "…" trong chuỗi UI rút gọn (nguyên văn đủ ở plan-frontend-i18n.md, ví dụ :73, :146, :175) hoặc tên dải mã ("CR-056…058") — vô hại. Ghi thành lỗ hổng: "~7 ngày", "~5" (#17). "tuỳ chọn" (spec.md:162, nhãn "(tuỳ chọn)") = trường không bắt buộc, vô hại.

## Chưa kiểm
- spike.md chỉ đọc phần Khuyến nghị (đầu vào plan D7–D9, không phải yêu cầu P-a).
- plan-frontend-i18n.md đọc chọn lọc (Grep các chuỗi được trỏ); không đối chiếu từng khoá vi/en.
- ui-admin §7.17, ui-agent-studio §15 và mockup canvas không mở (plan-frontend-admin §3 đã liệt kê lệch; studio là P-b).

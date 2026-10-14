# Readiness · P-c2-pr

## Lần 1 · 2026-10-14 · main 470c2f21 · NOT READY (3 Chặn, 6 Cao, 6 Trung, 9 Thấp; 0 câu hỏi mới)

Mọi lỗ hổng có mặc định an toàn, tự quyết theo Luật 2 (ghi spec §9 rồi chạy lại).

| # | Mức | Vấn đề | Mặc định |
|---|---|---|---|
| 1 | Chặn | `StageView.executor` của stage Áp chưa có giá trị (`ExecutorRefSchema` cần `key`, `name`) | `{kind:"apply", key:"apply", name:{vi:"Áp bản sửa", en:"Apply the fix"}}` |
| 2 | Chặn | FE không biết khi nào `gate.local` vs `gate.branch_only` | `apply_mode="branch_only"` và `apply_base===null` ⇒ `gate.local` |
| 3 | Chặn | Job Áp lấy url/branch từ cấu hình hiện tại hay `pin.url` | Cấu hình hiện tại; nguồn xoá / `config.url ≠ pin.url` / đổi kind ⇒ không tạo job, hàng `failed` + `provider_error`, `apply_failed` |
| 4 | Cao | Run huỷ khi job Áp đang chạy | `advanceApply` kiểm run + stage còn `running` trước khi gọi provider; đã huỷ ⇒ chỉ lưu hàng |
| 5 | Cao | "Xin slot giữa job" chưa có cơ chế | `SANDBOX_SLOT` đếm cả `type='source.apply'` lúc claim |
| 6 | Cao | Task R1/R2 trỏ file không tồn tại | R1: `runtimes/resolve/host.py`, `sources/{git_driver,resolve}.py`; R2: `db/apply_sql.py` + nối `queue/runtime.py` |
| 7 | Cao | Lệnh xong R2 thiếu int + migrate DB H1 | Migrate 0032 rồi pytest `pc2` + `-m int apply_int_test.py` qua `run.ts` |
| 8 | Cao | F1 (token) rủi ro `thường` | `cao` |
| 9 | Cao | Lệnh xong B2/B7 thiếu test khoá; `test:int` toàn bộ kéo ca đỏ task sau | Thêm file test của task; hồi quy liệt kê thư mục |
| 10 | Trung | plan §3.6 GET thiếu `tenant_id` ⇒ 400 | 404 `NOT_FOUND` |
| 11 | Trung | spec 25 670 B > 25 600 B | Tách §10 Q sang `spec-decisions.md` |
| 12 | Trung | BA HUB-BR-30/FR-129/BR-34 chưa theo Q2/Q4; chưa có CR | docs-architect thêm CR + sửa BA |
| 13 | Trung | Phục hồi sweep mâu thuẫn (interrupted ↔ C14) | `sweepOnce` gọi `advanceApply` cho job đã kết thúc mà stage Áp còn `running`; bỏ "interrupted" |
| 14 | Trung | Đua hai lần `advanceApply` | Tx khoá `process_runs FOR UPDATE`, kiểm lại trạng thái (mẫu `stage-driver.ts`) |
| 15 | Trung | `unsupported_provider` không luật nào sinh | Hub sinh khi mode ∈ {pr, auto_merge} mà `githubRepoOf(url)` null |
| 16 | Thấp | Thiếu 413 + thứ tự 401 trước 413 | Theo `internal/autofix.routes.ts` |
| 17 | Thấp | "vòng k" chân PR lấy từ đâu | `autofix_results.round` của kết quả được áp |
| 18 | Thấp | `auditRealAction` đòi `agentId` | `{agent_id:null, workflow_ids:[], executor:"apply"}` |
| 19 | Thấp | `<stage_key>` tên log test Áp | key stage Áp |
| 20 | Thấp | Lỗi `container` không báo cáo | Hàng `failed` + `provider_error`; lý do theo `applyOutcome` |
| 21 | Thấp | Không có khoá mà push bị từ chối ⇒ `auth` | `has_credential=false` ⇒ `no_credential` |
| 22 | Thấp | Cột File của B5/B7/R3 thiếu | Bổ sung; R3 bỏ "nếu qc cần" |
| 23 | Thấp | Chữ trạng thái cũ ("chờ mockup", "giả định") | Cập nhật |
| 24 | Thấp | Env thiếu `GITHUB_MOCK_PORT`/`GITHUB_MOCK_TOKEN` | Thêm `.env.example` ở B8 |

Chưa kiểm: nội dung mockup (người dùng đã duyệt), chi tiết từng ca test khoá, kích thước plan/test-plan.

Áp mặc định: #1, #3–#11, #13–#22, #24 và phần #23 của spec/plan/tasks (spec §9 C19–C35; #2, #12 thuộc frontend-lead/docs-architect; #23 plan-frontend/BA ngoài phạm vi) — commit 51f3af2a

## Lần 2 · 2026-10-14 · main 63da2dfe · NOT READY (1 Chặn, 5 Cao, 5 Thấp; 0 câu hỏi mới)

Lần 1 đã đóng: #1–#4, #6, #8, #10, #12–#20, #22, #24. Còn hở: #5, #7, #9, #21, #23. Spec 25 139 B (đạt).

| # | Mức | Vấn đề | Mặc định |
|---|---|---|---|
| 1 | Chặn | C34 `no_credential` vs `classify_push_error`/AP09 | `has_credential=false` + lỗi `auth` ⇒ `no_credential`; `push_rejected`/`network` giữ; đổi ở `ApplyHost` |
| 2 | Cao | `applyOutcome` khi có báo cáo + `jobReason`; trạng thái kết thúc job | Có báo cáo ⇒ theo `r.status` (trừ `container`); báo cáo được nhận ⇒ job `succeeded` |
| 3 | Cao | R2 "slot chỉ khi retest" ↔ C22 | Claim `source.apply` đòi (autofix + apply đang chạy) < `RUNTIME_SANDBOX_MAX`; sửa R2 |
| 4 | Cao | R2 migrate nhầm DB dev | `db:test:drop h1 && db:test:create h1` trước pytest (R2 + `done:pc2`) |
| 5 | Cao | B2/B3 `test:int` kéo ca đỏ P-c2 | B2: `packages/db` + `db.int.test.ts`; B3: thư mục hồi quy P-b + sources |
| 6 | Cao | B7 trỏ `sweeper*.ts`, thiếu `runs/autofix.rules.ts` | `runs/sweeps.ts` + `runs/autofix.rules.ts` |
| 7 | Thấp | `realActionPreconfirm` | `realActionPre` |
| 8 | Thấp | `apply_mode`/`apply_base` khi nguồn xoá/đổi kind | Cả hai `null` |
| 9 | Thấp | test-plan tham chiếu cũ; G7/G8/G16 | qc sửa câu chữ |
| 10 | Thấp | Chữ trạng thái cũ (spec-decisions:17, tasks T1, spec §5) | Cập nhật |
| 11 | Thấp | `done:pc2` bước 4 `test:int` toàn bộ | Liệt kê thư mục; P-c2 từng file |

Áp mặc định lần 2: #1–#8, #10 áp vào spec §9 (C36–C44; C19–C35 chuyển sang spec-decisions), plan, tasks; #9 qc, #11 để test-plan (commit xem git log).

## Lần 3 · 2026-10-14 · main 48e47332 · NOT READY (0 Chặn, 5 Cao, 5 Thấp; 0 câu hỏi mới)

Lần 2 đã đóng: #1–#11. Spec 24 686 B, plan 30 714 B (sát trần).

| # | Mức | Vấn đề | Mặc định |
|---|---|---|---|
| 1 | Cao | B1 `typecheck` đỏ: `thread.rules.ts` Record<DecisionReason>, `sources.errors.ts` Record<SourceErrorCode>, admin `def-form.ts:146` | B1 thêm 3 file; thread `apply_conflict` "bản sửa xung đột với mã mới"/"the fix conflicts with the new code", `apply_failed` "áp bản sửa không thành công"/"applying the fix failed"; MESSAGES = EN `apiError.SOURCE_*`; def-form `apply` ⇒ `"apply"` |
| 2 | Cao | DB pc2_qc/pc2_e2e tạo trước 0032 | B2: `bun run db:test:create pc2_qc` trước int; F3: `db:test:create pc2_e2e` |
| 3 | Cao | Lệnh e2e F1–F3 sai config | `bunx playwright test -c e2e/P-c2/playwright.pc2.config.ts --reporter=line` + `admin/sources.pc2.ts` (F1) / `admin/editor.pc2.ts` (F2) / `chat/` (F3) |
| 4 | Cao | Hàng không job (C20/invalid): mode/status/source_key | `failed`+`provider_error`; mode = effectiveApplyMode(nguồn còn) hoặc `branch_only`; source_key/branch/pin từ autofix_results; result null ⇒ key nguồn stage tự-sửa, branch/pin null |
| 5 | Cao | `withHandoff` thêm "Bàn giao" vào stage Áp | `ensureHandoff` chỉ cho `agent`; B7 thêm `defs/def.rules.ts` |
| 6 | Thấp | Job Áp lỗi container ghi cột nào | `apply_sql.py` FINISH ghi `error_reason='container'` |
| 7 | Thấp | plan §5.2 hai bước "7." | Đánh lại |
| 8 | Thấp | Chữ trạng thái cũ plan:3, tasks:3 | Cập nhật |
| 9 | Thấp | plan còn 6 B tới trần | Tách §5 sang `plan-runtime.md` |
| 10 | Thấp | D1 thiếu file script | `tools/scripts/src/done-pc2.ts` |

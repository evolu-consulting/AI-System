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

Áp mặc định: #1, #3–#11, #13–#22, #24 và phần #23 của spec/plan/tasks (spec §9 C19–C35; #2, #12 thuộc frontend-lead/docs-architect; #23 plan-frontend/BA ngoài phạm vi) — commit COMMIT_HASH

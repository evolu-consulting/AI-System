# Quyết định người dùng · P-c2-pr (chuyển từ spec §10, 2026-10-14)

## Câu hỏi Q1–Q10 (trình Gate; mỗi câu có mặc định đề xuất tối giản)
| # | Câu hỏi | Mặc định đề xuất |
|---|---|---|
| Q1 | Provider ở P-c2? | **Chỉ GitHub (`github.com`)**. GitLab/GHES để sau (thêm `gitProviderOf` + client). Nguồn host khác: mặc định `branch_only` |
| Q2 | Runtime nhận token `source_credential` qua kênh nội bộ (như `dify-credential`) để clone/fetch/push repo riêng? (HUB-BR-30 hiện nói "clone/fetch") | **Có** — chỉ trong bộ nhớ + env của tiến trình git; mở rộng HUB-BR-30 thêm "push" |
| Q3 | "Áp" là **stage riêng** (executor `apply`, sau stage tự-sửa) hay tự áp ngay khi gate stage tự-sửa Đạt? | **Stage riêng** (C1) — thấy được trên canvas, có kết quả/quyết định riêng |
| Q4 | Nghĩa của `branch_only`? | `local_path`: **không push, không clone lâu dài** — "nhánh" = diff đã duyệt ở Hub (tải `.diff`, `git apply`), vì Runtime không giữ trạng thái (B3) và cấm ghi `local_path`. `git_remote` + `branch_only`: **push nhánh `ai/…`, không mở PR** |
| Q5 | Rebase khi `main` đổi: chỉ xét lúc Áp; xung đột ⇒ chỉ "Thử lại / Huỷ"? | **Có**. Muốn sửa trên `main` mới ⇒ chạy lại quy trình. Tự quay lại stage tự-sửa trên `main` mới để sau |
| Q6 | `auto_merge`: bật auto-merge của GitHub kiểu **squash**; repo chưa bật "Allow auto-merge"/không có branch protection ⇒ PR vẫn mở, ghi "auto-merge không bật được", không "Cần người quyết"? | **Có** |
| Q7 | Nội dung PR: tiêu đề + mục `## Thay đổi`/`## Test` của output đã duyệt, không tên người duyệt, không đầu vào người dùng (PC2-R14)? | **Có** |
| Q8 | Ai đặt `apply_mode` (kể cả `auto_merge`)? | **tenant_admin** của tenant (như sửa nguồn); `local_path` cố định `branch_only` |
| Q9 | Smoke với GitHub thật (repo thử + fine-grained PAT: Contents RW, Pull requests RW, chỉ repo đó)? | **Không chặn mốc**: P-c2 đạt bằng mock + bare repo; người dùng cấp repo/PAT thì `qc-uat` chạy thêm (hard stop: secret thật) |
| Q10 | Khoá nguồn dùng cho cả nguồn **chỉ-đọc** P-b (vd `fixbug-evolu` đọc repo riêng)? | **Có** — cùng đường resolve, không thêm việc |

**Người dùng trả lời 2026-10-14:** chấp nhận mặc định Q1–Q10 (Q1 chỉ GitHub; Q2 Runtime nhận khoá qua kênh nội bộ, chỉ ngoài container; Q3 stage "Áp" riêng sau gate; Q4–Q10 như bảng). Mockup `Pc2-*` (T1) đã duyệt; qc viết test theo test-plan.

## Áp mặc định readiness lần 1 (2026-10-14; chi tiết plan) — C19–C35
| # | Quyết định |
|---|---|
| C19 | Stage Áp `executor` view = `{kind:"apply",key:"apply",name:{vi:"Áp bản sửa",en:"Apply the fix"}}` |
| C20 | Job Áp lấy url/branch từ nguồn **hiện tại**; nguồn xoá / `url≠pin.url` / đổi kind ⇒ không job, hàng `failed`+`provider_error`, `apply_failed` |
| C21 | `advanceApply` kiểm run + stage còn `running` trước khi gọi provider; run đã huỷ ⇒ chỉ lưu hàng |
| C22 | Slot sandbox dùng chung: claim tự-sửa **và** claim `source.apply` (`db/apply_sql.py`, không qua `CLAIM_SELECT` vì không `provider_key`) đòi (tự-sửa + Áp đang chạy) < `RUNTIME_SANDBOX_MAX` (C38); `SANDBOX_SLOT` đếm thêm `type='source.apply'` |
| C23 | Đường dẫn Runtime thật: R1 `runtimes/resolve/host.py`, `sources/{git_driver,resolve}.py`; R2 `db/apply_sql.py`, `queue/runtime.py` |
| C24 | Lệnh xong R2: `db:test:drop h1 && db:test:create h1` rồi pytest `pc2` + `-m int apply_int_test.py` qua `run.ts` (C39) |
| C25 | F1 rủi ro `cao`; lệnh xong B2/B7 thêm file test khoá; hồi quy liệt kê thư mục (không `test:int` toàn bộ) |
| C26 | GET thiếu `tenant_id` (platform_admin) ⇒ 404 `NOT_FOUND` (plan §3.6 sửa theo C12) |
| C27 | Sweep: `sweepOnce` gọi `advanceApply` cho job `source.apply` đã kết thúc mà stage còn `running`; bỏ "interrupted" |
| C28 | `advanceApply` chạy trong tx khoá `process_runs FOR UPDATE` + kiểm lại trạng thái (mẫu `lockAndLoad`) |
| C29 | `unsupported_provider`: Hub sinh khi mode ∈ {pr, auto_merge} mà `githubRepoOf(url)` null |
| C30 | `apply-result`: 401 trước 413, 413 `PAYLOAD_TOO_LARGE` (thân > 256 KiB), theo `autofix.routes.ts` |
| C31 | Chân PR "vòng k" = `autofix_results.round` của kết quả được áp |
| C32 | `auditRealAction` cho Áp: `agent_id:null, workflow_ids:[], executor:"apply"` |
| C33 | `<stage_key>` log test Áp = key stage Áp; lỗi `container` ⇒ hàng `failed`+`provider_error`, decision theo `applyOutcome` |
| C34 | `has_credential=false` + lỗi `auth` ⇒ `no_credential`; `push_rejected`/`network` giữ; đổi ở `ApplyHost` (C36) |
| C35 | Env test mock: `GITHUB_MOCK_PORT`, `GITHUB_MOCK_TOKEN` thêm `.env.example` (B8) |

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

**Người dùng trả lời 2026-10-14:** chấp nhận mặc định Q1–Q10 (Q1 chỉ GitHub; Q2 Runtime nhận khoá qua kênh nội bộ, chỉ ngoài container; Q3 stage "Áp" riêng sau gate; Q4–Q10 như bảng). Còn chờ: mockup `Pc2-*` (T1) trước khi qc viết test.

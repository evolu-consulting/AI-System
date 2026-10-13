# P-c · Quyết định chi tiết (phụ lục spec)

PLAN backend 2026-10-13. Spec chính: [`spec.md`](spec.md). Contract/DDL: [`plan.md`](plan.md). Hạ tầng: ADR-0011.

## §1 Vì sao P-c1 chỉ diff-only (Q1)
| Tiêu chí | P-c1 diff-only | Gộp PR vào cùng mốc |
|---|---|---|
| Tài liệu đã chốt | CR-061: "Phần diff-only làm trước phần PR"; HUB-FR-128 "làm trước, không cần mạng ra provider" | Không có chỗ nào yêu cầu gộp |
| Phụ thuộc ngoài | Không (repo công khai + `local_path`, Docker Desktop sẵn có) | Provider GitHub/GitLab thật, token `source_credential` thật (hard stop "secret thật"), repo thử để mở PR |
| Rủi ro mới | Container + kiểm diff (chính là rủi ro lõi) | + push ra ngoài, auto-merge, rebase/xung đột, quyền token tối thiểu |
| Giá trị dùng ngay | Có: người duyệt đọc diff, tải `.diff`, `git apply` tay | Có thêm PR tự động |
| Contract | P-c2 chỉ THÊM (stage "Áp" `real_action`, `sources.apply_mode`), không đổi P-c1 | — |
Kết luận: tách; P-c2 = HUB-FR-129, HUB-BR-34, `apply_mode` + UI màn Nguồn, rebase E4, repo riêng tư (Q5).

## §2 Lý do các quyết định B1–B8 (spec §9)
| # | Lựa chọn khác | Vì sao chọn cách trong spec |
|---|---|---|
| B1 nhánh `ai/<process_run_id>/<stage_key>` | `<step>` = số bước P-b2; id rút gọn 8 ký tự | Gate/làm lại theo stage; một bước có ≤ 3 stage ⇒ số bước không duy nhất. Id đầy đủ: không cần xử lý trùng khi push (P-c2) |
| B2 workspace từ snapshot đã lọc | `git clone` thô từ mirror | Một đường cho `git_remote` + `local_path`; tái dùng PB-R07 (không `.env*`/khoá/`.git` vào container); không có `.git` remote (cấu hình/hook độc). Khác: snapshot có trần riêng `caps=autofix` |
| B3 Runtime không trạng thái | Kho nhánh bare repo lâu dài ở Runtime | Không cần dọn theo TTL, restart/đổi máy không mất; Hub đã giữ diff (cần cho UI). P-c2 push: dựng nhánh từ commit ghim + diff cuối |
| B4 diff là attachment `text/plain` | Thêm MIME `text/x-diff`; cột `diff text` trong bảng | Không đổi allowlist upload của chat; không phình bảng; dùng sẵn endpoint tải file run + sweeper |
| B5 không công tắc tenant | Cờ `tenant_settings.autofix_enabled` | HUB-FR-130 "chỉ chạy khi tenant_admin bật" = bật bản chép quy trình (đã chỉ tenant_admin làm được) |
| B6 không rebase ở P-c1 | Rebase mỗi lần làm lại | Run ghim commit (HUB-BR-27); diff so với commit ghim luôn áp được lên chính commit đó. Rebase chỉ có nghĩa khi push/PR |
| B7 repo cố định trong def | Chọn bằng `source_ref` lúc chạy | `source_ref` (PB-R13) chỉ là đầu vào chữ cho agent, không đổi ghim. Ràng repo vào def giữ cổng ghim P-b nguyên vẹn |
| B8 không baseline test | Chạy test trước khi agent sửa | Thêm một lần chạy test dài; agent tự chạy được bằng `ws_exec` |

## §3 Cơ chế tool (Q4) — so sánh
| Phương án | Kết luận |
|---|---|
| A. Bash/Edit/Write/Read gốc của Claude CLI trên thư mục mount, Bash bọc `exec` qua hook sửa input | Hook sửa lệnh = chuỗi shell lồng, dễ thoát; Read/Edit gốc chạy trên host ⇒ container tạo symlink đua với kiểm `realpath` (TOCTOU) — **loại** |
| B. Cả Claude CLI chạy trong container | Phải đưa phiên subscription (`~/.claude`) vào container + mở egress Anthropic; mã repo đọc được token — **loại** (HUB-BR-34, ADR-0011 #4) |
| C. **4 tool MCP trong tiến trình Runtime, thực thi bằng `exec` trong container** | Mọi đọc/ghi/lệnh trên workspace xảy ra trong container; host chỉ chạy git cứng. Cần ngoại lệ HUB-BR-12 — **chọn** (chờ Q4) |

## §4 Ánh xạ "Điểm còn mở" của khung (spec cũ §10) → trả lời
| # khung | Trả lời |
|---|---|
| 1 runtime/mạng/trần | ADR-0011 #1–#3 (Q2, Q6) |
| 2 cài phụ thuộc không egress | Pha chuẩn bị có mạng, chỉ `install_cmd` (Q2) |
| 3 provider PR, quyền token, nhánh trùng, auto-merge, làm lại | PR/provider/auto-merge ⇒ P-c2. Nhánh trùng: không xảy ra (id run đầy đủ). Làm lại: PC-R11 |
| 4 trần mặc định, kích thước repo | ADR-0011 #3; repo ≤ 200 MB / 20.000 file sau lọc (PC-R04) |
| 5 hình dạng diff + UI duyệt; chọn `apply_mode` | `AutofixStageView` (plan §3.4); mockup plan §8; `apply_mode` ⇒ P-c2 |
| 6 audit | `hub.autofix_results` (PC-R12) |
| 7 chọn repo/branch, một repo/job | B7; một repo/job |
| 8 AC + `done:pc` | qc |
| 9 allowlist đường dẫn ở đâu; quét bí mật; trần rebase | `write_allowlist` theo **stage** (quy trình); mẫu plan §5.4; rebase ⇒ P-c2 |

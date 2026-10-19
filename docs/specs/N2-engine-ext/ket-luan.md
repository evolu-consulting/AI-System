# Kết luận lát N2 Mở rộng engine (2026-10-19)

Quyết định: **đóng N2** (CR-094 đợt 2, làn đầy đủ, một agent một lát). Cổng gộp đợt 2 và số đo: [`wave2-gate.md`](../wave2-gate.md). Số perf là số Windows dev; đo staging Linux còn chờ. Không làm tròn ngưỡng.

## 1. Phạm vi đã giao

N2-FR-01 cổng `PackRuns` (gói khởi chạy run Hub, kèm đường bù huỷ run khi gắn lỗi) · N2-FR-02 kết quả duyệt **Từ chối** (huỷ run, feedback) · N2-FR-03 registry tool gói + stage `tool` + `/mcp` (hạn giờ, quyền theo `action`) · N2-FR-04 trần run đồng thời theo tenant (`admin.tenants.process_runs_max`, migration admin 0013; hub 0041) · N2-FR-05 cờ stage `exclude_starter`. FE: admin-web (ô trần, checkbox), nhãn `reject`/429 ở chat-web.

## 2. Kết quả

| Hạng mục | Kết quả |
|---|---|
| Review (`review.md`) | **APPROVED** (`576c1cc2`): 0 Cao, 5 Trung, 10 Thấp; đã sửa ở `55362f7b` |
| Security (`security-review.md`) | **SAFE** (`3b2b25e6`): 2 Trung (người bắt đầu quyết `redo_limit`/`back_limit`; quyền tool gói theo action) đã sửa ở `55362f7b`; người dùng chốt N2-D06 |
| Cổng gộp 2026-10-19 | Int N2 xanh (chạy riêng); e2e admin `e2e/N2` **1/2**: ca `exclude_starter` xanh, ca trần run đỏ vì ô múi giờ báo "chưa được hỗ trợ" trên Chromium 153 (nợ #227, ngoài lát N2); typecheck test có 5 lỗi kiểu trong `tests/acceptance/N2` (nợ #228, test khoá) |
| Perf (`PERF=1`, d2) | P01 p95 12,4 ms (22 câu, = không tool), P02 p95 8,0 ms (2 câu), P03 p95 24,6 ms (63 câu cả cửa sổ, 14 câu driver), P05 p95 6,6 ms (2 câu); **P04 p95 50,9 ms đỏ so ngưỡng 30** (46 câu cả nhảy 1 và nhảy 7: số câu đạt, thời gian chờ đo staging) |

Commit: `feae3775` (spec + test trước) · `42767d4f`, `e61572f4`, `48571f97` · `c7dcb639` · `8da10761`, `8213d6da` (lock) · `55362f7b` (vòng sửa).

## 3. Quyết định chính

N2-D06 (người dùng chốt: decision `redo_limit`/`back_limit` cũng chặn người bắt đầu), N2-D08 (`PackRuns.outcomes`), N2-D12 (tool gói có hạn giờ), N2-D13/D14 (quyền tool theo `action`, gỡ tool trùng khoá). Mã lỗi mới ở khối riêng `CHAT_PROCESS_N2_ERRORS`, không đổi khối khoá P-a/P-b2. Không đổi test khoá P-d.

## 4. Nợ liên quan (TECH-DEBT.md)

| # | Nội dung |
|---|---|
| 227 | Ô múi giờ admin-web từ chối `Asia/Ho_Chi_Minh` (Chromium/Node chỉ liệt kê `Asia/Saigon`): chặn lưu tenant, đỏ e2e N2 trần run |
| 228 | 5 lỗi kiểu `tsc -p tsconfig.tests.json` ở 3 file `tests/acceptance/N2` (`toEqual([])` trên `RowList`) |
| 229 | Test khoá cũ đỏ do đổi contract/hành vi từ P-d2 trở đi (layers PD-A03, contracts-pa R-K01…) — không do N2 |

## 5. Việc còn lại

| Việc | Ai | Khi |
|---|---|---|
| chat-web: thông báo 429 theo trần tenant (hiện hằng 5), nút Từ chối | frontend-lead | HD3 |
| Tool gói trong `/mcp` chỉ hiện khi agent khai khoá trong `payload.mcp.tools` | backend-lead | HD6 |
| Sửa #227, #228 | frontend-lead / qc | Trước khi coi e2e N2 xanh |
| Đo P04 trên staging Linux | Người dùng | Trước Gate release |

# Kết luận lát P-d2 (2026-10-18)

Quyết định của người dùng: **đóng P-d2 ngay**; perf PD2-P04 (và PD-P13/P14 của P-d1) chờ đo staging Linux, giữ ngưỡng, không làm tròn.

## 1. Phạm vi đã giao

Stage `tool` (gọi workflow qua pipeline `/mcp`, `side_effect`/`real_action` D2-49) · công tắc tool theo tenant ADM-FR-73 (module `apps/admin-api/src/modules/workflow-tools/`, tab "Tool quy trình") · rẽ nhánh `after.branch` + `skipped` + quay lại qua bước `skipped` · input `number` (D2-44) · notice chuyển cấp có nhóm/`after_h` (D2-47) · `ProcessRunSummary` `wait_until`/`retry_at` cho run-list admin (D2-45, một câu theo tập).

## 2. Kết quả

| Hạng mục | Kết quả |
|---|---|
| `done:pd2` (b4f2650) | **10/11** xanh; đỏ = bước perf: PD-P13, PD-P14 (P-d1), PD2-P04 |
| Review chung (`review.md`) | Vòng 1 CHANGES REQUESTED (R-1 Major audit `authorize_real_action` stage tool; R-2 Major hàm dài) → sửa c54a891 + 3996ec6 → vòng 2 **APPROVED** (e34a555) |
| Security S1–S12 | **SAFE** (64e9242): 1 Major M1 (`side_effect` kiểm lúc chạy) + m1/m2, sửa 26b8d53 |
| UAT (`evidence/2026-10-18-pd2/REPORT.md`) | **ĐẠT CÓ ĐIỀU KIỆN** (f5dcc1d): không lỗi Chặn/Cao, 4 điểm Thường |
| Sửa UAT (8bbbfab) | B-D2-1 lỗi số i18n, B-D2-3 huy hiệu retry ở list, B-D2-4 "Đã chuyển cấp" trang run. B-D2-2 (Lưu def tool đã tắt bị chặn ở client) **đúng thiết kế** |

Kiểm lại P-d1: B1, B2, B3 (khung luồng kẹt skeleton), B6 đã sửa; B4/B5 một phần ở UAT, hết sau 8bbbfab (B-D2-3/4).

## 3. Perf (Luật 4c)

| Ca | Số đo (Windows dev) | Ngưỡng | Kết |
|---|---|---|---|
| PD2-P01 lưu def 10 stage | 13,9 / 13,8 ms (có tool) vs 13,0 / 11,5 (không); +1 câu | ≤ trước + 5 ms | Đạt |
| PD2-P02 editor context | 2 câu, p95 10–11 ms | — | Đạt |
| PD2-P03 chạy stage tool | tool 71 → 65 câu, driver 19 → 14 (plan §9); mốc so sánh chênh phân xử ở T18-perf-1 | ≤ mốc agent + 14 câu | Đạt sau phân xử |
| PD2-P04 POST Đạt + rẽ nhánh | trước p50 ~41 → **p50 ~26 / p95 ~43 ms** (n=40; 3 vòng 2846c49, fb8ac3a, fd53f88; sàn ước 20–23 ms) | p95 ≤ 30 ms | **Chưa đạt, chờ staging** |
| PD2-P05 run-list 50 run | 2 câu cố định, p95 ~11,5 ms | ≤ 40 ms | Đạt |

Không khớp giữa nguồn: tasks.md ghi P03 "đỏ +18" ở T18-perf rồi chờ phân xử; gate/`done:pd2` chỉ liệt kê P04 là đỏ của P-d2 — lấy theo gate, đánh dấu để qc xác nhận khi chạy lại `PERF=1`.

## 4. Quyết định chính (`spec-decisions.md`)

D2-43 nhãn `…tool.argValue` · D2-44 input `number` · D2-45 `wait_until`/`retry_at` · D2-46 seed e2e `pd2-branch`/`pd2-globex` · D2-47 notice `escalated` + `group`/`after_h` · D2-48 cách đo P-d2 (làm nóng bằng `max`+2, n=40, giữ ngưỡng) · D2-49 `real_action` chặn khi không có người Đạt. Ngoài kế hoạch: `packages/db/src/prepare-spread.ts` (phát chữ ký câu chuẩn bị sang cả pool, chỉ `server.ts` bật).

## 5. Nợ mới (TECH-DEBT)

| # | Nội dung |
|---|---|
| 200 | H2c content/upload/send: 3 ca đỏ có từ trước P-d2 |
| 201 | Tắt Hub/harness test chưa chờ vòng nền (Hub đã sửa; còn `pa.ts stop`) |
| 202 | Helper test P-d còn poll `waitFor` (Luật 4c) |
| 203 | Tên nhóm notice cố định `vi` |
| 204 | Chặn tool `real_action` ở bước 0 ngay lúc lưu def (`TOOL_INVALID`) |

## 6. Việc còn lại

| Việc | Ai | Khi |
|---|---|---|
| Chạy `deploy/staging/run-spike.ps1 -LoadN 10000` (nay gồm `perf/` P-d1 + P-d2); báo p95 PD-P13/P14/PD2-P04. P04 > 30 ms trên Linux ⇒ thiết kế lại (launch stage kế ngoài tx quyết định) | Người dùng | Trước Gate release |
| Nợ #202 (qc), #204 (backend-lead + qc) | qc / backend-lead | Khi chạm file liên quan |
| Việc kế tiếp GĐ1: Intake gói nghiệp vụ duyệt hợp đồng (chưa có spec) | Điều phối | Sau khi người dùng giao |
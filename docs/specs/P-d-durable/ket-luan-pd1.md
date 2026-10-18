# Kết luận lát P-d1 (2026-10-18)

Quyết định của người dùng: **đóng P-d1 ngay**; perf p95 chờ staging; 2 chỗ contract ⇒ T17 (P-d2); kiểm lại lỗi UAT B3 ở T20.

## 1. Trạng thái

| Hạng mục | Kết quả |
|---|---|
| Build | T1–T12 xong |
| Review T12 (`review.md`) | Vòng 1: CHANGES REQUESTED, 1 Major (thứ tự khoá lô) — sửa theo phương án B (ae6d290): claim task `SKIP LOCKED`, rồi run `FOR KEY SHARE SKIP LOCKED`, lô không bao giờ chờ. Vòng 2: APPROVED. Security: SAFE |
| `done:pd1` (2026-10-18, sau sửa) | 6/7 bước xanh; 1 đỏ = bước perf (p95 chập chờn trên máy dev Windows) |
| UAT (`evidence/2026-10-18/REPORT.md`) | ĐẠT CÓ ĐIỀU KIỆN |

`done:pd1` — xanh: typecheck; depcruise 0 `ca-*`; unit; int P-d + hồi quy P-a/P-b/P-b2/P-c/P-c2; e2e P-d 12/12; test lock. Đỏ: perf.

## 2. Perf (chưa chốt — chờ staging)

| Ca | Số đo (máy dev, rảnh) | Ngưỡng | Kết |
|---|---|---|---|
| PD-P13 nhắc | p95 43–46 ms; 10.000 trong 4,8–5,1 s | p95 ≤ 50 ms | Đạt |
| PD-P14 hết hạn | p95 42–73 ms (nhiễu); 20.000 trong 9,5–12,5 s | p95 ≤ 50 ms | Chập chờn |

Xác nhận bằng staging (Linux, Redis thật): `deploy/staging/run-spike.ps1 -LoadN 10000` (nay chạy thêm `test:perf:pd`). Công cụ chặn Claude chạy lệnh này ⇒ **người dùng chạy**. Chưa đạt trên staging thì mở lại, không làm tròn số.

## 3. UAT P-d1

| Mục | Trạng thái |
|---|---|
| B1, B2, B4, B5-badge, D1, B6-subject | Đã sửa (30f2c11) |
| D2 | Không phải lỗi |
| B3 | Còn mở ⇒ kiểm lại ở UAT **T20** |
| Contract: trường notice chuyển cấp (tên nhóm, số giờ, `HistoryItem` kind `escalate`) cho mockup 03 D4 | ⇒ **T17** |
| Contract: `ProcessRunSummary` thêm trường chờ/thử lại cho ô "Giai đoạn" của danh sách run admin | ⇒ **T17** |

## 4. Thay đổi ngoài kế hoạch gốc

| Thay đổi | Ghi chú |
|---|---|
| CR-093 vòng nền theo tập | Nhắc 3 câu SQL/lô, hết hạn 3; làm nóng pool |
| Luật 4c (CLAUDE.md) | Hiệu năng là yêu cầu; không sleep/poll |
| Sửa deadlock thread poster (`lockEventRun`) | Đóng TECH-DEBT #192 |
| Kiểm section template lúc lưu def | `TEAM_SECTION_UNOWNED`; chỉ `lead_plan` điền "—" |
| Tốc độ test | DB mẫu + `test:int:par`: int đầy đủ 38 → 9,5 phút |

## 5. Việc tiếp

| Việc | Ai | Khi |
|---|---|---|
| Chạy `run-spike.ps1 -LoadN 10000`, báo p95 PD-P13/P14 | Người dùng | Trước Gate release |
| 2 chỗ contract | backend-lead | T17 |
| Kiểm lại B3 | qc-uat | T20 |
| P-d2 | điều phối | Đang ở T16 |

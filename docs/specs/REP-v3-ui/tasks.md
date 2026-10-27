---
id: REP-v3-ui
lát: B2 (UI)
cr: CR-101b (Intake 2026-10-27 R56, R57, R68, R71, R74, R55)
làn: nhanh (Sonnet)
migration: không
phụ thuộc: REP-v3 đã merge (API). Không phụ thuộc đợt A UI.
---
# REP-v3-ui — Đối tác, Cài đặt uy tín 5 ô, Tổng quan

## Plan (ngắn)
Đối tác: biểu đồ điểm 3/6/12 tháng có đường ngưỡng TỐT/KHÁ; chấm 1–5 sao từng tiêu chí (lý do khi lệch > 25); bấm tiêu chí xem từng việc góp điểm và các bước ra điểm; nhãn MỚI · tạm tính và cờ đỏ giữ. Cài đặt: 5 ô nhóm × vai, mỗi ô 3 tab Tiêu chí · Thời gian · Loại việc; Mức & đánh giá; thử tính; chấm cam mục đã đổi (thay `ScoringPane` HD8 hai tab). Tổng quan TQ-04 (đối tác CHÚ Ý hoặc giảm ≥ 3 điểm/3 tháng) và nguồn Cần xử lý "Đánh giá đối tác".

## Làm
| # | Việc |
|---|---|
| 1 | `features/partners*`: biểu đồ lịch sử, ô sao, danh sách việc theo tiêu chí |
| 2 | `features/settings/components/ScoringPane.tsx` → 5 ô × 3 tab (tách thành file nhỏ ≤ 200 dòng) |
| 3 | Overview TQ-04 + todo "Đánh giá đối tác" (hiển thị; nguồn ở backend REP-v3) |
| 4 | Gỡ hint "chỉ đọc/410" của U3; unit lib; e2e `v2i-partners`, `v2l-settings`, `overview` viết lại (không chạy) |

## Không làm
Engine, API, hộp xác nhận mốc, danh sách chứng từ.

## Chạm
`W/features/partners/**`, `settings/components/ScoringPane*` + `settings/lib/scoring*`, `overview/**` (TQ-04), `locales/contracts/rep3.*.json`. Không chung file với DOC-ui-list/ui-frame (khác thư mục; `contract-detail`, `contracts-list`, `contract-form`, `nav.ts` KHÔNG chạm).

## Test tối thiểu
Unit lib thuần (chuẩn hoá sao, ô → thân API, nhóm màu ngưỡng); e2e viết không chạy.

## Việc còn lại
- [ ] 1–4.

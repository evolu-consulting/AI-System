---
id: K4-reopen-version
lát: A6 (backend nhỏ + chút UI)
cr: CR-101a (Intake 2026-10-27 R12, R14, R15; X4, X5; Câu 5, 6, 10)
làn: đầy đủ (quyền; nhỏ)
migration: 0058_k4 (journal idx 54, when 1799200000000) — CHỈ nếu cần cột/log; mặc định không migration
phụ thuộc: không về logic; chạy song song với DOC-model. Nếu cùng sửa `upload-version*`, DOC-model merge trước, K4 rebase.
---
# K4 — Mở lại, số "-SĐn", phụ lục → phiên bản

## Plan (ngắn)
1. **Mở lại HĐ đã khoá:** người phụ trách của HĐ HOẶC owner gói; lý do bắt buộc; log như nay (đổi guard `admin` → kiểm người phụ trách).
2. **Số phiên bản:** khi AI không đọc được số trên văn bản mới ⇒ điền sẵn "số gốc-SĐn" (n = version_no − 1), sửa được; chỉ điền sẵn, không ép.
3. **Phụ lục:** ngừng tạo phụ lục mới (AppendixPanel ẩn nút tạo); phụ lục cũ giữ, chỉ đọc trong chi tiết HĐ; phụ lục sửa đổi qua "Tải bản cập nhật"; gia hạn vẫn là HĐ mới nối tiếp. Đảo CR-097 Q9 (phụ lục riêng) một phần; K2-06 (phụ lục ⇒ 422) giữ.

## Làm
| # | Việc |
|---|---|
| 1 | `reopen-contract.usecase.ts` + guard route: người phụ trách hoặc owner; lý do bắt buộc; test trước cho ma trận quyền (403 editor khác) |
| 2 | `domain/version-number.rules.ts` (mới, thuần, test) + một dòng gọi ở nơi điền số khi tải bản cập nhật |
| 3 | `POST /contracts/:id/appendices` ⇒ 410 `USE_VERSIONS`; GET phụ lục cũ giữ |
| 4 | UI: `features/appendix/AppendixPanel.tsx` ẩn tạo mới, nhãn chỉ đọc; nút "Mở lại" hiện cho người phụ trách |

## Không làm
Phụ lục kiểu mới, đổi cơ chế gia hạn, đổi khoá K1, chuyển phụ lục cũ thành phiên bản (số phụ lục prod = 0).

## Chạm (lát khác KHÔNG sửa)
`H/application/reopen-contract*`, route guard mở lại, `H/domain/version-number.rules.ts`, `appendices*` route, `W/features/appendix/**`, nút Mở lại trong `contract-detail` (một dòng gắn — merge sau DOC-ui-frame, hoặc đặt trong component `ReopenButton.tsx` mới); `tests/acceptance/K1/*` (reopen).

## Test tối thiểu
Unit `version-number.rules.test.ts`; int mở lại (owner ✓, người phụ trách ✓, editor khác ⇒ 403, thiếu lý do ⇒ 422); phụ lục tạo ⇒ 410. Không chạy e2e.

## Việc còn lại
- [ ] 1–4.

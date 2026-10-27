---
id: K4-reopen-version
lát: A6 (backend nhỏ + chút UI)
cr: CR-101a (Intake 2026-10-27 R12, R14, R15; X4, X5; Câu 5, 6, 10)
làn: đầy đủ (quyền; nhỏ)
migration: không (không cần cột/log mới — 0058 chưa dùng)
phụ thuộc: không về logic; chạy song song với DOC-model. Không chạm `upload-version*` / `upload-contract*`.
---
# K4 — Mở lại, số "-SĐn", phụ lục → phiên bản

## Plan (ngắn)
1. **Mở lại HĐ đã khoá:** người phụ trách của HĐ HOẶC owner gói; lý do bắt buộc; log như nay (đổi guard `admin` → kiểm người phụ trách).
2. **Số phiên bản:** khi AI không đọc được số trên văn bản mới ⇒ điền sẵn "số gốc-SĐn" (n = version_no − 1), sửa được; chỉ điền sẵn, không ép.
3. **Phụ lục:** ngừng tạo phụ lục mới (AppendixPanel ẩn nút tạo); phụ lục cũ giữ, chỉ đọc trong chi tiết HĐ; phụ lục sửa đổi qua "Tải bản cập nhật"; gia hạn vẫn là HĐ mới nối tiếp. Đảo CR-097 Q9 (phụ lục riêng) một phần; K2-06 (phụ lục ⇒ 422) giữ.

## Làm
| # | Việc | Làn |
|---|---|---|
| 1 | `reopen-contract.usecase.ts` + guard route: người phụ trách hoặc owner; lý do bắt buộc; test trước cho ma trận quyền (403 editor khác) | đầy đủ (test trước) |
| 2 | `domain/version-number.rules.ts` (mới, thuần, test) + một dòng gọi ở nơi điền số khi tải bản cập nhật | nhanh |
| 3 | Gắn làm phụ lục ⇒ 410 `USE_VERSIONS`; GET phụ lục cũ giữ | nhanh |
| 4 | UI: `features/appendix/AppendixPanel.tsx` ẩn tạo mới, nhãn chỉ đọc; nút "Mở lại" hiện cho người phụ trách | nhanh |

## Không làm
Phụ lục kiểu mới, đổi cơ chế gia hạn, đổi khoá K1, chuyển phụ lục cũ thành phiên bản (số phụ lục prod = 0).

## Quyết định trong lúc làm
- **Q1 quyền mở lại:** route `write` (viewer ⇒ 403 `PACK_FORBIDDEN`, 0 SQL) → đọc thân (thiếu lý do ⇒ **400** `VALIDATION_ERROR`, giữ như K1 thay vì 422 trong plan) → `admin` tính từ cache quyền (0 SQL) → câu SQL duy nhất kiểm `admin ∨ owner_user_id = actor` dưới `FOR UPDATE`; không được phép ⇒ **403 `REOPEN_FORBIDDEN`** (mã mới, `LOCK_ERRORS`), không ghi gì. Luật thuần `canReopen` (domain) = điều kiện SQL. HĐ không thấy (RLS/tenant khác) ⇒ 404 như cũ. Vẫn 1 tx, 2 câu.
- **Q2 "-SĐn":** gốc = số của bản v1 (`root_id`); hậu tố `-SĐk` có sẵn ở số gốc bị thay (không chồng). Điền ở bước lưu kết quả AI (`run-extraction.usecase` → `prefillVersionNumber`) khi `fields.number` trống và chưa `edited`; giá trị `verified=false`, `quote=""` ⇒ người kiểm thấy là chưa xác minh, sửa được. `extraction.repo.source` thêm `version_no` + số gốc (cùng câu, không thêm câu SQL). Không chạm `upload-*` (DOC-model).
- **Q3 phụ lục:** API không có `POST /contracts/:id/appendices`; hai đường tạo phụ lục là (a) `PATCH /contracts/:id/parent` (gắn) và (b) tải lên `kind=appendix`. Làm (a): gắn (`parent_id` ≠ null) ⇒ **410 `USE_VERSIONS`** sau guard + đọc thân, trước kiểm khoá; **gỡ** (`parent_id: null`) vẫn được (dọn dữ liệu cũ, UI không hiện). (b) nằm ở `upload-contract.usecase` (vùng DOC-model) ⇒ **để lại** (xem Việc còn lại); UI không có đường tải phụ lục nên người dùng không tạo được.
- **Q4 UI:** `AppendixPanel` chỉ đọc (bỏ Gắn/Gỡ, thêm nhãn `appendix.readOnly`) — panel vẫn chưa gắn vào trang (ux-excel E3). Link "Mở lại" = `reopenRight` (owner gói ∨ editor phụ trách) ở `lock-view.ts`, một dòng ở `ContractReviewPage`.
- **Q5 test đổi theo luật mới:** HD5 int (gắn thành công / cha không hợp lệ / gắn đồng thời) thay bằng 410 + gỡ vẫn được; K1 int `PATCH /parent` khi khoá ⇒ 410 (trước 409); e2e k3a dùng HĐ do người khác phụ trách cho ca "editor không thấy Mở lại"; e2e hd5 (đang skip) đổi sang kiểm chỉ đọc.

## Test
- Unit: `domain/version-number.rules.test.ts` (mới), `domain/lock.rules.test.ts` (+`canReopen`, `forbidden`), `contract-lock/lib/lock-view.test.ts` (+`reopenRight`, `USE_VERSIONS`).
- Int: `tests/acceptance/K4/reopen.int.test.ts` (mới, viết trước code: phụ trách ✓, owner ✓, editor khác 403, thiếu lý do 400) + K1/lock, HD5 sửa — 22 pass.
- e2e: `e2e/contracts-web/k4-reopen.cw.ts` (mới: editor phụ trách mở lại, 403 hiện câu lỗi, số "-SĐ1" điền sẵn sửa được) — cả bộ contracts-web 193 pass / 20 skip.

## Việc còn lại
- [x] 1–4.
- [x] (doc-deals-fix) Tải lên `kind=appendix` ⇒ 410 `USE_VERSIONS` trong `upload-contract.usecase.ts` (sau khi DOC-model merge; sửa kèm HD1 upload int ca phụ lục).

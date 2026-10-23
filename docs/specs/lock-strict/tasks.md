# lock-strict (CR-097 K1, người dùng chốt 2026-10-23) — làn nhanh

HĐ đã xác nhận/khoá: KHÔNG sửa được gì trong thông tin và định nghĩa mốc. Chỉ còn thao tác vận hành.

## Quyết định
- BE: `lock.rules` `LOCK_EDITABLE_FIELDS` rỗng (cả `notice_days` ⇒ 409 `CONTRACT_LOCKED`); thêm/sửa/xoá mốc, gắn SP cho dòng (PUT items/:id/product, POST product-links), gắn/gỡ HĐ gốc ⇒ 409 `CONTRACT_LOCKED`.
  Còn cho phép khi khoá: giao việc, ghi nhận xử lý, xác nhận xong mốc (settle), hoãn/nhắc, ghi việc với đối tác + huỷ, tóm tắt AI.
- BE: `POST /review` thêm `draft: true` ("Lưu nháp"): chỉ ghi, HĐ giữ `needs_review` (không khoá) kể cả tenant tắt duyệt.
- FE: HĐ khoá ⇒ mọi ô chỉ đọc, ẩn "Lưu thay đổi", "+ Thêm mốc", bút sửa mốc; chọn SP ở dòng chỉ đọc; còn "Xác nhận xong".
- FE A: bỏ nút + khoang "Văn bản gốc" và link "Xem đoạn này…" (code `contract-source` giữ lại).
- FE B/E: luật nút đầu trang `lib/head-rule.ts`: needs_review ⇒ Huỷ + Lưu nháp (chỉ ghi) + (tenant tắt duyệt) "Xác nhận và lưu" (ghi rồi xác nhận ⇒ khoá); bật duyệt giữ thẻ duyệt. Bỏ menu "⋯" cho tenant tắt duyệt (chưa làm).
- FE C: Huỷ luôn làm gì đó: có sửa ⇒ bỏ sửa; chưa sửa ⇒ về `/contracts` (giữ nháp).
- FE F: thông báo lưu thành công = toast; `SaveNotice` chỉ còn lỗi (không khối giữ chỗ).
- Bỏ nút "Xoá hợp đồng" cuối trang chi tiết (icon thùng rác ở danh sách: lát khác).
- Không làm ở lát này (agent khác): D (icon mắt không khung), G phần danh sách.

## Test đã sửa (qc)
- Unit: `lock.rules.test.ts`, `lock-view.test.ts`, mới `head-rule.test.ts`.
- Int: `K1/lock.int.test.ts` (notice_days 409, thêm/sửa/xoá mốc 409, gắn SP 409, gắn HĐ gốc 409, settle 200; Lưu nháp vs Xác nhận).
- Fixture (DB luôn khoá HĐ xác nhận, UPDATE khoá lại): `unlockContract` (hd1) dùng trong `HD7 deal()`, `V2-A manual()` (`keepLocked`), `V2-G seedReview`, `V2-D item()`, `HD5`; `V2-G attach world()` dùng `needs_review`; `V2-G perf` đo gắn SP trước khi xác nhận.
- e2e: `k3a-lock`, `v2g-review`, `hd2-flow`, `gap-a2-source-ask`, `v2f-detail`, `hd3-flow`, `products-confirm` (toast thay dòng status).
- V2-D perf "1 dòng = 20 dòng" (9 vs 10 câu SQL) đỏ sẵn từ trước lát (kiểm bằng git stash), không do lát này.

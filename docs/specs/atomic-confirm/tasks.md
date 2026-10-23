# atomic-confirm — xác nhận + gắn SP trong một tx (tenant tắt duyệt)

Làn: **đầy đủ** (khoá HĐ + dữ liệu khách). Int viết trước code. Người dùng chốt 2026-10-24 (thay f2fdc7e3).

## Plan
- [x] `POST /review` (lệnh xác nhận, không `draft`) nhận `products` (cùng `ProductLinksSchema` của approve); `draft` + `products` ⇒ 400.
- [x] Trong tx review: sau câu lưu ra `active` (trigger K1 khoá) gọi cùng cổng `ProductLinksRepo.link` (không strict) như bước duyệt cuối;
  dòng lạ (`matched` < số gửi) / SP tenant khác (FK) ⇒ ném ⇒ ROLLBACK cả lệnh (HĐ giữ needs_review, chưa khoá, không SP).
- [x] Revert lỗ f2fdc7e3: `product-links` route (strict) + HĐ đã khoá ⇒ 409 `CONTRACT_LOCKED` cho MỌI link.
- [x] FE: "Xác nhận và lưu" (tắt duyệt) = ghi nháp ⇒ hộp "Gắn sản phẩm" (HĐ có dòng) ⇒ một `POST /review {version, products}`;
  bỏ `linkNewFormLines` ở trang xác nhận (giữ ở form nhập tay — tạo tay đang tắt 410).

## Quyết định trong lúc làm
- Gắn SP chạy SAU câu đổi trạng thái nhưng TRONG cùng tx (giống finalize của máy duyệt) — repo đòi HĐ "đã xác nhận"; nguyên tử như nhau.
- Bật duyệt: `products` trong `/review` bị bỏ qua (HĐ còn chờ) — SP gắn ở bước duyệt cuối như cũ.

## Test
- Int: `tests/acceptance/K1/atomic-confirm.int.test.ts` (5 ca) + K1 lock "gắn SP sau khoá" ⇒ 409 cả lần đầu.
- Unit: `contract-review/lib/confirm-save.test.ts`. e2e: `v2g-review` (hộp + thân), `k3a-lock`.

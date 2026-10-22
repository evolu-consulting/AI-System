# products-confirm — SP chỉ tạo/gắn khi HĐ đã xác nhận; xoá HĐ hỏi xoá SP mồ côi

Nguồn: khách review trang "Sản phẩm & Giá" (2026-10-22). Làn: **đầy đủ một phần** (policy RLS xoá SP + hàm xoá HĐ, migration 0046) — còn lại làn nhanh.

## Hiện trạng (trước lát)
- SP được tạo **ở trình duyệt** lúc Lưu: `productIdsOf` (form nhập tay `use-contract-form.ts` và màn xác nhận `use-info-form.ts`) gọi
  `POST /products` cho mỗi dòng chọn "＋ Tạo sản phẩm mới" — kể cả khi HĐ lưu xong vẫn `needs_review` (tenant bật duyệt). Không có tạo
  SP phía máy chủ từ extract/outbox.
- Xoá HĐ (`contracts.delete_contract`, 0035) **tự xoá** SP `created_from_contract_id` = HĐ nếu không còn dùng; SP tạo từ form không có
  `created_from_contract_id` ⇒ không bao giờ được dọn. Không hỏi người xoá.

## Thay đổi
1. **Không tạo SP lúc lưu**: `productIdsOf` chỉ trả SP đã chọn sẵn; dòng "tạo mới" ⇒ `null`. Lưu xong mà HĐ `active` (tắt duyệt) ⇒
   `linkNewFormLines` gọi `POST /contracts/:id/product-links` cho các dòng "tạo mới" (khớp dòng form có tên ↔ dòng đã lưu theo `ord`).
2. **API mới** `POST /contracts/:id/product-links` (write): `{links: [{item_id, product_id} | {item_id, new_product:{name, unit?, group}}]}`
   ⇒ `{created, linked}`. MỘT câu SQL set-based; HĐ chưa xác nhận ⇒ 409 `CONTRACT_NOT_CONFIRMED`; HĐ có dòng kho ⇒ 409 `ITEM_LOCKED`;
   tenant khác ⇒ 404. SP mới: `created_from_contract_id` = HĐ, HĐ Mua ⇒ NCC chính = bên bán; trùng tên SP có sẵn ⇒ gắn SP đó.
3. **Duyệt**: `POST /contracts/:id/approval` nhận thêm `products` (cùng dạng `links`); chỉ áp khi `finalize` thành công, trong cùng tx
   (`linkOnConfirm`). Không đổi luật ai được duyệt.
4. **UI duyệt**: "Xác nhận"/"Duyệt" ⇒ (lưu ô đã đổi) ⇒ hộp "Gắn sản phẩm" (`features/product-links`) liệt kê dòng HĐ: "Dùng sản phẩm có
   sẵn" (SP trùng tên, tốt nhất chọn sẵn) / "Tạo sản phẩm mới" (mặc định khi không trùng) ⇒ gửi kèm `approve`. HĐ không có dòng ⇒ duyệt thẳng.
5. **Xoá HĐ**: xem trước thêm `orphan_products [{id,name}]` = SP gắn HĐ (dòng HĐ hoặc sinh từ HĐ) mà không còn dòng HĐ / dòng kho của HĐ
   khác. Hộp xoá có ô chọn "Xoá các sản phẩm không còn hợp đồng nào dùng?" (mặc định không chọn). `DELETE /contracts/:id` nhận
   `{remove_products: uuid[]}`. Migration **0046**: `delete_contract(id, tenant, products[])` kiểm lại mồ côi TRƯỚC khi xoá HĐ rồi chỉ xoá SP
   được chọn; bản 2 tham số thành vỏ gọi với `{}` (không xoá SP); policy `products_v2m_del` đổi sang cờ `contracts.v2m_del_products`
   (hàm đặt/xoá cờ trong tx — cùng mô hình cờ `v2m_del` của 0035).

## Quyết định trong lúc làm
- Hộp gắn SP hiện ở mọi lần "Xác nhận/Duyệt" có dòng hàng; nếu bước đó chỉ chuyển cấp 2 thì máy chủ bỏ qua lựa chọn (người duyệt cấp 2
  chọn lại). Đơn giản hơn việc đoán ngưỡng ở trình duyệt.
- Dòng HĐ chọn SP có sẵn trong form vẫn được gắn lúc lưu (không tạo dữ liệu mới); chỉ việc **tạo** SP bị hoãn tới khi xác nhận.
- Không chuyển dữ liệu: HĐ đang `needs_review` đã lỡ tạo SP giữ nguyên; HĐ đã xác nhận giữ SP.
- `tests/acceptance/V2-M/delete.int.test.ts` sửa: xoá kèm `remove_products` (hành vi cũ tự xoá SP đã bỏ theo yêu cầu khách).

## Test
- Unit: `contracts-web/.../product-links/lib/links.test.ts`, `contract-delete/lib/impact.test.ts`, `hub-api/.../approval-links.test.ts`.
- Int: `tests/acceptance/products-confirm/links.int.test.ts` (endpoint mới), `delete-orphans.int.test.ts` (chọn SP mồ côi, policy mới),
  `V2-M/delete.int.test.ts` (sửa).

## Còn lại
- e2e hộp gắn SP / hộp xoá: chưa viết (chạy cuối đợt).
- SP dùng bởi HĐ mà người xoá không thấy (M1) ⇒ không vào danh sách mồ côi nhưng nếu được chọn thì FK chặn ⇒ lỗi 500 (như 0035).

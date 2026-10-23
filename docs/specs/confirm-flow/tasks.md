# confirm-flow — sửa lỗi "Xác nhận và lưu" kẹt hộp Gắn sản phẩm (production 2026-10-23)

Làn nhanh (UI + luồng duyệt; máy chủ không đổi).

## Nguyên nhân
- Máy chủ đúng: `POST /review` ở cấp 1 KHÔNG mở lại lượt / đọc lại; `approve` không bao giờ đưa lượt về `extracting` (chỉ `redo`
  hoặc `/extract` mới làm vậy). Int `tests/acceptance/HD3/confirm-edit.int.test.ts` khoá: đổi loại HĐ + dòng ⇒ approve kèm SP ⇒
  `active`/`done`; giá trị ≥ ngưỡng ⇒ `level2`; không lượt mới, không gọi model.
- HĐ thành `extracting` sau hai `POST /approval` 200 ⇒ đó là `redo` ("Đọc lại" trong menu ⋯ cạnh "Xác nhận và lưu", mục đầu tiên).
- Hộp "Gắn sản phẩm" chỉ đóng khi `act` thành công; bước đã đổi (409 APPROVAL_NOT_OPEN) ⇒ hộp kẹt + câu "Bước duyệt đã thay đổi".
  Thêm: quyết hộp theo `finalizes_on_approve` CŨ (trước khi lưu giá trị mới); HĐ không nạp lại sau khi lưu (Huỷ hộp rồi bấm lại ⇒ 409 stale).

## Quyết định
- Ẩn "Đọc lại" (redo kèm lý do) ở UI (người dùng 2026-10-23); backend redo giữ nguyên. Trích lại chỉ qua "AI đọc lại từ đầu".
- `afterConfirm` (thuần): thành công mọi bước ⇒ đóng hộp + tải lại; `level2` ⇒ toast "Đã xác nhận — chờ Ban giám đốc duyệt";
  APPROVAL_NOT_OPEN/REVIEW_TASK_CLOSED ⇒ đóng hộp, tải lại, câu rõ ràng; lỗi khác ⇒ giữ hộp.
- Sau lưu: đọc lại trạng thái duyệt MỚI để quyết có hộp hay không; nạp lại HĐ. Một thao tác một lúc (ref chặn bấm đúp).
- Khối Quản lý: "AI đọc lại từ đầu" cùng hàng "Giao cho" (phải; flex-wrap trên mobile).

## Việc
- [x] Int tái hiện (HD3/confirm-edit) · [x] unit `afterConfirm` + menu ⋯ · [x] FE sửa · [x] layout

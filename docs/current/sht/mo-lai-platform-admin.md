# Platform admin mở lại hợp đồng / lượt duyệt của công ty (CR-121 Q-3)

Nguồn: lát cr121-q3-platform-reopen (gộp 2026-11-09, đợt cr125-wave).

## Mở lại hợp đồng đã khoá
Quản trị nền tảng (platform_admin) mở lại HĐ đã khoá của bất kỳ công ty nào có bật gói Hợp đồng, qua đúng chức năng "Mở lại" của quản trị công ty; bắt buộc chỉ rõ `tenant_id` và lý do (1–500 ký tự), thiếu ⇒ 400 và HĐ vẫn khoá. HĐ về "Chờ duyệt", mở khoá, lịch sử ghi sự kiện `reopened` (người mở, công ty, HĐ, lý do). Thành viên (không vai ghi) ⇒ 403; tenant_admin công ty khác ⇒ 403 `PACK_DISABLED`. Mở 2 lần (kể cả đồng thời) chỉ một lần thành công, lần còn lại 409 `CONTRACT_NOT_LOCKED`, một sự kiện. Quyền xét theo vai: platform_admin mở được dù không phụ trách/không owner gói; cờ platform false/vắng không cấp quyền.

## Xử lý lượt duyệt kẹt
platform_admin mở lại / thử lại / huỷ & mở lại lượt duyệt kẹt của một công ty qua đúng 3 chức năng của quản trị công ty; bắt buộc `tenant_id` + lý do (1–500). Thiếu công ty hoặc lý do sai ⇒ 400; công ty không khớp HĐ ⇒ 404; hợp lệ ⇒ 200. Lịch sử HĐ ghi dòng ý định TRƯỚC thao tác và dòng kết quả sau.

## Nút "Mở lại quy trình" ở Chi tiết lượt chạy (admin-web)
Trang chi tiết lượt chạy hiện nút cho platform_admin với lượt gắn HĐ của mọi công ty (tenant_admin chỉ công ty mình); thẻ xác nhận có ô lý do bắt buộc (tối đa 500 ký tự).
# Lớp nổi và xác nhận (CR-177 nhóm B)

Component: `dialog`, `alert-dialog`, `sheet` (thay DockSheet), `dropdown-menu`, `popover`, `tabs`, `toggle-group`, `radio-group`, `combobox`, `inline-confirm`; `toastUndo` ở `ui/toast.tsx`.
Chữ nhãn (Đóng, Huỷ…) truyền qua prop; mặc định tiếng Việt.

## 4 mức xác nhận
1. Đổi lại được ⇒ làm luôn + `toastUndo(message, onUndo)` (6 giây).
2. Cần nhập (lý do…) ⇒ `InlineConfirm` tại chỗ, `required` thì nút khoá khi ô trống.
3. Người khác thấy / khó rút ⇒ `Dialog` ngắn, nút ghi đúng hành động («Gửi báo giá», không «OK»).
4. Mất dữ liệu ⇒ `AlertDialog variant="danger"`, con trỏ mặc định ở «Giữ lại».

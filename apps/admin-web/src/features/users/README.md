# features/users

Quản lý user [ADM-FR-04] [ADM-FR-05] [ADM-FR-63]; platform_admin (chọn tenant) và tenant_admin (tenant của mình).

- `api.ts`: hook TanStack Query cho `/admin/users*` (list có `counts`, detail, create, update theo `version`, lock/unlock/reset/logout-all) và danh sách tenant cho ô chọn.
- Bộ lọc, trang và drawer nằm trên URL (`?tenant&q&status&role&login&page&drawer&user`, `routes/_authed/users.tsx`).
- `hooks/`: `use-users-view` (tenant đang xem + nạp list), `use-users-nav` (đổi search), `use-user-actions` (khoá/reset/đăng xuất mọi thiết bị có xác nhận, mở khoá ngay).
- `pages/UserDrawerController`: nối drawer với API, ánh xạ lỗi server (409 USERNAME_TAKEN/EMAIL_TAKEN/LAST_ADMIN) vào ô; 401 để modal phiên hết hạn xử lý.
- Mật khẩu tạm (D10) chỉ ở state của drawer/dialog: không URL, không cache (`gcTime: 0`), đóng khi chưa sao chép thì hỏi lại.
- `lib/status.ts`: trạng thái hàng và menu theo hàng (hàng "(bạn)" chỉ có Sửa); `lib/schemas.ts`: schema form.

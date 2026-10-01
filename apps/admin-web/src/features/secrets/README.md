# features/secrets

Quản lý Secrets [ADM-FR-50] (M2): key dùng chung cho workflow, **chỉ ghi, không xem lại được**; chỉ `platform_admin`.

- `api.ts`: hook TanStack Query cho `/admin/secrets*` (list có `counts`, tìm theo tên, tạo, `PUT` thay giá trị, `PATCH` ghi chú, xoá). Tạo/thay giá trị dùng `gcTime: 0`.
- Bộ lọc, trang và drawer nằm trên URL (`?q&used=true|false&page&drawer=new|replace|note&secret=<NAME>`, `routes/_authed/secrets.tsx`; `used` là boolean để URL là `used=false`).
- `components/`: `SecretTable` (cột `•••• last4`, link workflow, menu `⋯`), `SecretDrawer` + `SecretForm` + `SecretField` (password, Hiện/Ẩn chỉ giá trị đang gõ), `SecretsEmpty`.
- `hooks/use-secret-delete`: đang dùng hoặc 409 `SECRET_IN_USE` → `BlockedDialog` + `DependencyList`; còn lại `ConfirmDialog` nặng (gõ lại tên).
- `pages/SecretDrawerController`: ánh xạ lỗi server vào ô (`SECRET_NAME_TAKEN`, `VALIDATION_ERROR` theo `details.issues`, câu tĩnh, không dùng `message` server).
- D10 (không rò giá trị): giá trị chỉ ở state RHF của form (unmount khi đóng drawer, `resetField` sau khi gửi), không URL/localStorage/toast/title; toast chỉ có tên và `last4`.
- `lib/schemas.ts`: tên (trim, HOA, `^[A-Z0-9_]{2,64}$`), giá trị 8–2048 (UTF-16, không trim), ghi chú ≤ 200; thông điệp là key i18n.

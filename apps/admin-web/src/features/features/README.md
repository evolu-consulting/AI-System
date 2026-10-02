# features/features

Quản lý Features và entitlement [ADM-FR-30] [ADM-FR-31] [ADM-FR-33] [ADM-FR-34] [ADM-BR-10] (M2): gói command cấp cho tenant; chỉ `platform_admin`. `core` hiệu lực với mọi tenant, không xoá/tắt/đổi Beta được.

- `api.ts`: hook TanStack Query cho `/admin/features*` (list có `counts`, chi tiết, tạo, `PATCH` kèm `version`, xoá), command cho ô "Thêm command", tenant cho ô "+ Cấp cho tenant", entitlement (list, `PUT` cấp, `DELETE` thu hồi).
- Danh sách (`/features?q&status&page`): `FeatureTable` + `FeatureRowMenu` (Sửa · Bật · Chuyển sang Beta · Tắt · Xoá; `core` chỉ Sửa), `DisableFeatureDialog` (kill switch mức vừa: nêu số command và `affected_user_count`), xoá: có command độc quyền (`feature_count = 1`) → `BlockedDialog`, không thì gõ key.
- Editor (`/features/new`, `/features/$id?tab=info|commands|tenants`): `FeatureInfoTab` (key khoá sau khi lưu, tên/mô tả VI/EN, icon 16 lựa chọn, trạng thái; `core` khoá), `FeatureCommandsTab` (danh sách là **nháp** lưu chung với tab Thông tin; bỏ command chỉ thuộc feature này → cảnh báo mồ côi và chặn Lưu), `FeatureTenantsTab` (lưu ngay từng thao tác).
- `hooks/use-feature-form`: lưu, version lấy từ phản hồi lưu (refetch sau đó không dựng lại form làm mất chỉnh sửa vừa gõ); `VERSION_CONFLICT → ConflictDialog (M3)" (không modal diff, không ghi đè). `hooks/use-entitlement-actions`: cấp, thu hồi (gõ mã công ty) kèm Hoàn tác 5 s = cấp lại cùng hàng.
- `lib/icons.ts` (map tĩnh 16 icon), `lib/schemas.ts` (featureSchema, body, `removedOrphans`).

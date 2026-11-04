-- CR-118 · cr118-config-consistency: `home` của `/pack/me` theo `default_app` của user (rồi của công ty). Hub đọc `admin.users`
-- theo GRANT từng cột (0002, 0028) ⇒ thêm đúng một cột, chỉ SELECT. `admin.tenants.default_app` hub_ro đã đọc được (SELECT bảng).
-- Ghi `default_app` (user/công ty) ở admin-api bump `config_version` + NOTIFY `config_changed` kèm tenant_id cùng transaction.
GRANT SELECT (default_app) ON admin.users TO hub_ro;

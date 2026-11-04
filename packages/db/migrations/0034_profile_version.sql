-- CR-118 · cr118-r1-fixes #3: đổi theo tenant/user không đụng catalog (`default_app` của user/công ty, brand công ty) KHÔNG
-- bump `config_version` toàn cục nữa (mọi hub nạp lại cả ảnh Admin + bỏ mọi memo `/pack/me`). Bump cột riêng này + NOTIFY
-- `profile_changed` {v, entity, tenant_id} cùng transaction ⇒ Hub chỉ nạp lại lát tenant/user; poll cột này = lưới an toàn khi
-- mất NOTIFY. Hub đọc qua SELECT bảng sẵn có; admin_rw UPDATE bảng sẵn có.
ALTER TABLE admin.config_meta ADD COLUMN IF NOT EXISTS profile_version bigint NOT NULL DEFAULT 0
  CONSTRAINT config_meta_profile_version_check CHECK (profile_version >= 0);

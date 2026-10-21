-- prefs-sync · giao diện sáng/tối theo người dùng, cạnh `locale`; mặc định light. Thêm cột, không đổi dữ liệu cũ.
ALTER TABLE admin.users ADD COLUMN IF NOT EXISTS theme text NOT NULL DEFAULT 'light';
ALTER TABLE admin.users ADD CONSTRAINT users_theme_check CHECK (theme IN ('light', 'dark', 'system'));

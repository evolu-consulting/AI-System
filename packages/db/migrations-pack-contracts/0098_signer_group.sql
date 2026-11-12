-- CR-127 · P2 · BR-61 · spec §2.4 · R#31: nhóm "Người ký HĐ" của công ty (chọn người ký khi Đồng ý ký cùng lúc; `isSigner` của uỷ quyền ký số).
-- Một cột trên `partner_settings` (RLS tenant có sẵn từ 0087). `group_id` thuộc `admin.groups` — gói không FK sang admin (ranh giới schema).
-- Chỉ cộng thêm; chạy lại vô hại.
ALTER TABLE contracts.partner_settings ADD COLUMN IF NOT EXISTS signer_group_id uuid;

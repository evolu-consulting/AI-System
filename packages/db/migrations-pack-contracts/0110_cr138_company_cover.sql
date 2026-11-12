-- CR-138 · Q8: màu chủ đạo 12 màu đặt sẵn + mã màu tự chọn `#rrggbb` (cùng cột `accent`, một nguồn); Q9: ảnh bìa công ty `cover`
-- (data URL PNG/JPG/WebP ≤ 3 MB ảnh gốc ⇒ ≤ 4,3 triệu ký tự), lưu cạnh `logo`. Chỉ cộng thêm/nới ràng buộc; vắng hàng ⇒ mặc định trong code.
ALTER TABLE contracts.company_settings ADD COLUMN IF NOT EXISTS cover text;
--> statement-breakpoint
ALTER TABLE contracts.company_settings DROP CONSTRAINT IF EXISTS company_settings_cover_ck;
--> statement-breakpoint
ALTER TABLE contracts.company_settings ADD CONSTRAINT company_settings_cover_ck
  CHECK (cover IS NULL OR (char_length(cover) <= 4300000 AND cover ~ '^data:image/(png|jpeg|webp);base64,'));
--> statement-breakpoint
ALTER TABLE contracts.company_settings DROP CONSTRAINT IF EXISTS company_settings_accent_ck;
--> statement-breakpoint
ALTER TABLE contracts.company_settings ADD CONSTRAINT company_settings_accent_ck
  CHECK (accent IN ('indigo', 'violet', 'magenta', 'rose', 'orange', 'amber', 'lime', 'green', 'teal', 'sky', 'blue', 'slate')
    OR accent ~ '^#[0-9a-f]{6}$');

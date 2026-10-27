-- esign-anchor · danh sách cụm tìm khối chữ ký trong văn bản HĐ theo công ty: `approval_settings.esign_anchors` = {"a": [...], "b": [...]}
-- (NULL ⇒ mặc định trong code). Chỉ cộng thêm; chạy lại vô hại. Không đổi RLS (cột trên bảng đã FORCE RLS).
ALTER TABLE contracts.approval_settings ADD COLUMN IF NOT EXISTS esign_anchors jsonb;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE contracts.approval_settings ADD CONSTRAINT approval_settings_esign_anchors_ck
    CHECK (esign_anchors IS NULL OR (jsonb_typeof(esign_anchors) = 'object' AND pg_column_size(esign_anchors) <= 4096));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- HUB-FR-138 · HUB-FR-139 · FB1 driver FileBox, core-only (spec FB1 §3.2).
-- Viết tay, idempotent. CHỈ THÊM 2 cột tham chiếu FileBox vào hub.attachments (NULL ⇒ hàng kho local) — không mất dữ liệu.
ALTER TABLE hub.attachments ADD COLUMN IF NOT EXISTS filebox_file_id text;
--> statement-breakpoint
ALTER TABLE hub.attachments ADD COLUMN IF NOT EXISTS filebox_version_id text;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attachments_filebox_file_id_ck') THEN
    ALTER TABLE hub.attachments ADD CONSTRAINT attachments_filebox_file_id_ck
      CHECK (filebox_file_id IS NULL OR octet_length(filebox_file_id) BETWEEN 1 AND 256);
  END IF;
END $$;

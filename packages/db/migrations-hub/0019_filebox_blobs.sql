-- HUB-FR-44 · CR-filebox · driver file đính kèm `filebox`: ánh xạ khoá storage `<tenant>/<id>` (hub.attachments.storage_key)
-- → `file_id` của FileBox. Chỉ Hub (role hub_rw) đọc/ghi, chỉ scope `system` (driver chạy ngoài request người dùng:
-- upload, sweeper). Không FK tới attachments: hàng có thể có trước hàng attachments (pha `stage`) và sống sau nó (mồ côi
-- chờ sweeper) — như file `.part` của driver `local`. Viết tay, idempotent; chỉ thêm bảng — không mất dữ liệu.
CREATE TABLE IF NOT EXISTS hub.attachment_blobs (
  storage_key text NOT NULL,
  file_id text,
  partial boolean NOT NULL DEFAULT true,
  size bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT attachment_blobs_pkey PRIMARY KEY (storage_key),
  CONSTRAINT attachment_blobs_key_ck CHECK (storage_key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  CONSTRAINT attachment_blobs_file_ck CHECK (file_id IS NULL OR file_id ~ '^[0-9a-f]{16,64}$'),
  CONSTRAINT attachment_blobs_size_ck CHECK (size >= 0)
);
--> statement-breakpoint
ALTER TABLE hub.attachment_blobs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'hub' AND tablename = 'attachment_blobs'
                 AND policyname = 'attachment_blobs_system') THEN
    CREATE POLICY attachment_blobs_system ON hub.attachment_blobs FOR ALL TO hub_rw
      USING (current_setting('app.scope', true) = 'system')
      WITH CHECK (current_setting('app.scope', true) = 'system');
  END IF;
END
$$;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON hub.attachment_blobs TO hub_rw;
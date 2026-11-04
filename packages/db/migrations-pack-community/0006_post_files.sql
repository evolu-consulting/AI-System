-- CR-118 · cr118-community-files · spec §11.1 "Đính kèm": bài đính kèm tệp bất kỳ trong danh sách cho phép (ATTACH_ALLOWED).
-- Byte ở FileBox org `t_<tenant>`; hàng ở bảng khung `community.files` (kit 0001: chỉ policy tenant). Ở đây:
--  (1) `media` nhận kind `file` + metadata (tên/cỡ/mime đã sniff ở server), FK kép (file_id, tenant_id) → files;
--  (2) `files` thêm policy RESTRICTIVE theo người xem: thấy hàng ⇔ chính người tải lên HOẶC tệp nằm trên một bài người xem
--      THẤY ĐƯỢC (EXISTS media ⇒ `media_visible` ⇒ `posts_visible`, cùng luật bảng tin, gồm đối tác). Ghi chỉ dưới tên mình.
ALTER TABLE community.media DROP CONSTRAINT IF EXISTS media_ck;
--> statement-breakpoint
ALTER TABLE community.media ADD COLUMN IF NOT EXISTS name text;
--> statement-breakpoint
ALTER TABLE community.media ADD COLUMN IF NOT EXISTS mime text;
--> statement-breakpoint
ALTER TABLE community.media ADD COLUMN IF NOT EXISTS size_bytes bigint;
--> statement-breakpoint
ALTER TABLE community.media ADD CONSTRAINT media_ck CHECK (kind IN ('image', 'video', 'file')
  AND char_length(label) <= 200 AND (url IS NULL OR char_length(url) <= 2000) AND position BETWEEN 0 AND 11
  AND (kind <> 'file' OR file_id IS NOT NULL)
  AND (file_id IS NULL OR (name IS NOT NULL AND mime IS NOT NULL AND size_bytes IS NOT NULL))
  AND (name IS NULL OR char_length(name) BETWEEN 1 AND 255) AND (mime IS NULL OR char_length(mime) <= 128)
  AND (size_bytes IS NULL OR size_bytes BETWEEN 0 AND 20971520));
--> statement-breakpoint
ALTER TABLE community.media DROP CONSTRAINT IF EXISTS media_file_fk;
--> statement-breakpoint
ALTER TABLE community.media ADD CONSTRAINT media_file_fk FOREIGN KEY (file_id, tenant_id)
  REFERENCES community.files (id, tenant_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS media_file_idx ON community.media (file_id) WHERE file_id IS NOT NULL;
--> statement-breakpoint
DROP POLICY IF EXISTS files_visible ON community.files;
--> statement-breakpoint
CREATE POLICY files_visible ON community.files AS RESTRICTIVE FOR SELECT TO community_rw
  USING (coalesce(current_setting('app.user_id', true), '') = ''
    OR created_by = NULLIF(current_setting('app.user_id', true), '')::uuid
    OR EXISTS (SELECT 1 FROM community.media m WHERE m.file_id = files.id AND m.tenant_id = files.tenant_id));
--> statement-breakpoint
DROP POLICY IF EXISTS files_insert ON community.files;
--> statement-breakpoint
CREATE POLICY files_insert ON community.files AS RESTRICTIVE FOR INSERT TO community_rw
  WITH CHECK (coalesce(current_setting('app.user_id', true), '') = ''
    OR created_by = NULLIF(current_setting('app.user_id', true), '')::uuid);
--> statement-breakpoint
DROP POLICY IF EXISTS files_update ON community.files;
--> statement-breakpoint
CREATE POLICY files_update ON community.files AS RESTRICTIVE FOR UPDATE TO community_rw
  USING (coalesce(current_setting('app.user_id', true), '') = ''
    OR created_by = NULLIF(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (coalesce(current_setting('app.user_id', true), '') = ''
    OR created_by = NULLIF(current_setting('app.user_id', true), '')::uuid);

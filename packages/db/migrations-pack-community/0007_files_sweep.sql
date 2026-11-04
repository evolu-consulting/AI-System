-- CR-118 · cr118-r2-server · dọn tệp bài không dùng (vòng nền Community, `files.sweep.ts`): kit 0001 thu hồi DELETE trên
-- `<k>.files` ("xoá = deleted_at"). Riêng `community.files` cho phép DELETE CỨNG nhưng khoá bằng policy RESTRICTIVE: chỉ scope
-- HỆ THỐNG (không `app.user_id`), chỉ hàng đã đánh dấu (`deleted_at`) và không còn nằm trên bài nào ⇒ user không xoá cứng được,
-- vòng nền không xoá nhầm tệp đang gắn. Policy `files_tenant` (kit) vẫn giới hạn theo `app.tenant_id`.
GRANT DELETE ON community.files TO community_rw;
--> statement-breakpoint
DROP POLICY IF EXISTS files_delete ON community.files;
--> statement-breakpoint
CREATE POLICY files_delete ON community.files AS RESTRICTIVE FOR DELETE TO community_rw
  USING (coalesce(current_setting('app.user_id', true), '') = ''
    AND deleted_at IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM community.media m WHERE m.file_id = files.id AND m.tenant_id = files.tenant_id));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS files_sweep_idx ON community.files (tenant_id, created_at);

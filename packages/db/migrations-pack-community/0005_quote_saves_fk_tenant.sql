-- PK-FR-02 · com-fix-pool-scope: FK nội schema gói phải chứa tenant_id ở CẢ HAI đầu (FK kép, N1 rls guard). 0004 tạo
-- `quote_saves_comment_fk (comment_id)` đơn ⇒ đổi sang (comment_id, tenant_id) → comments (id, tenant_id); ON DELETE vẫn chỉ
-- xoá `comment_id` (giữ tenant_id NOT NULL). `comments` thêm UNIQUE (id, tenant_id) làm đích (như posts/threads 0001).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'comments_id_tenant_uq'
                 AND conrelid = 'community.comments'::regclass) THEN
    ALTER TABLE community.comments ADD CONSTRAINT comments_id_tenant_uq UNIQUE (id, tenant_id);
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE community.quote_saves DROP CONSTRAINT IF EXISTS quote_saves_comment_fk;
--> statement-breakpoint
ALTER TABLE community.quote_saves ADD CONSTRAINT quote_saves_comment_fk FOREIGN KEY (comment_id, tenant_id)
  REFERENCES community.comments (id, tenant_id) ON DELETE SET NULL (comment_id);

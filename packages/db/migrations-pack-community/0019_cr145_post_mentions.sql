-- CR-145 · nhắc NGƯỜI trong bài đăng (nghiep-vu §6/§10). `post_mentions` = người được nhắc theo bài (≤ 10, ghi cùng tx với bài).
-- `user_name`/`user_org` chụp lúc nhắc (feed không đọc `admin.users`; `user_org` NULL = chủ quản) — đối tác chỉ thấy phần tử là chủ quản
-- hoặc công ty mình (không lộ người của đối tác khác — chặn ngay ở RLS, không chỉ ở SQL feed). Đọc: theo bài thấy được (RLS `posts` áp trong EXISTS, cùng khuôn `media`).
-- Ghi: chỉ trên bài của bên mình (cùng `post_items`); luật "ai nhắc được ai" kiểm ở service bằng `orgsSeeingPost` (một nguồn, G1).
CREATE TABLE IF NOT EXISTS community.post_mentions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  post_id uuid NOT NULL,
  user_id uuid NOT NULL,
  user_name text NOT NULL DEFAULT '',
  user_org uuid,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT post_mentions_pkey PRIMARY KEY (post_id, user_id),
  CONSTRAINT post_mentions_id_uq UNIQUE (id),
  CONSTRAINT post_mentions_post_fk FOREIGN KEY (post_id, tenant_id)
    REFERENCES community.posts (id, tenant_id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS post_mentions_user_idx ON community.post_mentions (tenant_id, user_id);
--> statement-breakpoint
SELECT packs.secure_table('community', 'post_mentions');
--> statement-breakpoint
CREATE POLICY post_mentions_visible ON community.post_mentions AS RESTRICTIVE FOR SELECT TO community_rw
  USING ((SELECT packs.viewer_ext_org()) IS NULL OR (
    (post_mentions.user_org IS NULL OR post_mentions.user_org = (SELECT packs.viewer_ext_org()))
    AND EXISTS (SELECT 1 FROM community.posts p
      WHERE p.id = post_mentions.post_id AND p.tenant_id = post_mentions.tenant_id)));
--> statement-breakpoint
CREATE POLICY post_mentions_insert ON community.post_mentions AS RESTRICTIVE FOR INSERT TO community_rw
  WITH CHECK (coalesce(current_setting('app.user_id', true), '') = '' OR EXISTS (SELECT 1 FROM community.posts p
    WHERE p.id = post_mentions.post_id AND p.tenant_id = post_mentions.tenant_id
      AND p.author_org IS NOT DISTINCT FROM (SELECT packs.viewer_ext_org())));
--> statement-breakpoint
CREATE POLICY post_mentions_delete ON community.post_mentions AS RESTRICTIVE FOR DELETE TO community_rw
  USING (coalesce(current_setting('app.user_id', true), '') = '' OR EXISTS (SELECT 1 FROM community.posts p
    WHERE p.id = post_mentions.post_id AND p.tenant_id = post_mentions.tenant_id
      AND p.author_org IS NOT DISTINCT FROM (SELECT packs.viewer_ext_org())));

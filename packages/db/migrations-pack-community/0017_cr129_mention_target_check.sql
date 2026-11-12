-- CR-129 · soát RLS Minor-1: `comments_insert` (0015) để chủ quản (author_org NULL) ghi `mention_orgs` bất kỳ ở tầng DB. Thêm kiểm:
-- mọi công ty được nhắc phải là công ty ĐỐI TÁC ĐANG HOẠT ĐỘNG của chính tenant hiện tại VÀ thấy được bài (bài đối tác ⇒ chỉ công
-- ty đăng; bài chủ quản ⇒ trong audience — cùng luật `orgsSeeingPost` của service). DEFINER vì `community_rw` không đọc
-- `admin.external_orgs` (cùng khuôn `packs.scope_ext_org`); khoá tenant bằng GUC `app.tenant_id` + lọc tường minh.
CREATE OR REPLACE FUNCTION community.mention_target_ok(p_post uuid, p_org uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM community.posts p
    JOIN admin.external_orgs o ON o.tenant_id = p.tenant_id AND o.id = p_org AND o.active
    LEFT JOIN contracts.community_partners(ARRAY[p_org]) pc ON true
    WHERE p.id = p_post AND p.tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
      AND CASE WHEN p.author_org IS NOT NULL THEN p.author_org = p_org
        ELSE community.audience_ok(p.aud_mode, p.aud_cats, p.aud_orgs, p.type, p.cats, p_org,
          coalesce(pc.roles, '{}'), coalesce(pc.cats, '{}')) END)
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION community.mention_target_ok(uuid, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION community.mention_target_ok(uuid, uuid) TO community_rw;
--> statement-breakpoint
DROP POLICY IF EXISTS comments_insert ON community.comments;
--> statement-breakpoint
CREATE POLICY comments_insert ON community.comments AS RESTRICTIVE FOR INSERT TO community_rw
  WITH CHECK (coalesce(current_setting('app.user_id', true), '') = ''
    OR (author_org IS NOT DISTINCT FROM (SELECT packs.viewer_ext_org())
      AND EXISTS (SELECT 1 FROM community.posts p WHERE p.id = comments.post_id AND p.tenant_id = comments.tenant_id)
      AND NOT EXISTS (SELECT 1 FROM unnest(comments.mention_orgs) m
        WHERE m IS NOT DISTINCT FROM comments.author_org
          OR NOT community.sides_friend(comments.author_org, m)
          OR NOT community.mention_target_ok(comments.post_id, m))));

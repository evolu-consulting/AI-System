-- CR-102 · com-c3 · sửa sau security review: TB2 (url media chỉ http/https), TB3 (bình luận phải đúng luồng của bài + công ty,
-- không đổi bài/luồng khi sửa), Thấp3 (ghi nhãn đối tác chỉ Admin chủ quản — kit 0007 `packs.viewer_is_admin`).
GRANT EXECUTE ON FUNCTION packs.viewer_is_admin(text) TO community_rw;
--> statement-breakpoint
ALTER TABLE community.media ADD CONSTRAINT media_url_scheme_ck CHECK (url IS NULL OR url ~* '^https?://');
--> statement-breakpoint
DROP POLICY IF EXISTS partner_companies_viewer ON community.partner_companies;
--> statement-breakpoint
CREATE POLICY partner_companies_viewer ON community.partner_companies AS RESTRICTIVE FOR ALL TO community_rw
  USING ((SELECT packs.viewer_ext_org()) IS NULL OR ext_org_id = (SELECT packs.viewer_ext_org()))
  WITH CHECK ((SELECT packs.viewer_ext_org()) IS NULL
    AND (coalesce(current_setting('app.user_id', true), '') = '' OR (SELECT packs.viewer_is_admin('community'))));
--> statement-breakpoint
DROP POLICY IF EXISTS comments_insert ON community.comments;
--> statement-breakpoint
CREATE POLICY comments_insert ON community.comments AS RESTRICTIVE FOR INSERT TO community_rw
  WITH CHECK (EXISTS (SELECT 1 FROM community.threads t WHERE t.id = comments.thread_id
      AND t.tenant_id = comments.tenant_id AND t.post_id = comments.post_id AND t.ext_org_id = comments.thread_org)
    AND (coalesce(current_setting('app.user_id', true), '') = ''
      OR (author_org IS NOT DISTINCT FROM (SELECT packs.viewer_ext_org())
        AND ((SELECT packs.viewer_ext_org()) IS NULL OR thread_org = (SELECT packs.viewer_ext_org()))
        AND EXISTS (SELECT 1 FROM community.posts p WHERE p.id = comments.post_id AND p.tenant_id = comments.tenant_id))));
--> statement-breakpoint
DROP POLICY IF EXISTS comments_update ON community.comments;
--> statement-breakpoint
CREATE POLICY comments_update ON community.comments AS RESTRICTIVE FOR UPDATE TO community_rw
  USING ((SELECT packs.viewer_ext_org()) IS NULL OR (author_org = (SELECT packs.viewer_ext_org())
    AND author_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid))
  WITH CHECK (((SELECT packs.viewer_ext_org()) IS NULL OR author_org = (SELECT packs.viewer_ext_org()))
    AND EXISTS (SELECT 1 FROM community.threads t WHERE t.id = comments.thread_id
      AND t.tenant_id = comments.tenant_id AND t.post_id = comments.post_id AND t.ext_org_id = comments.thread_org));
--> statement-breakpoint
-- Bình luận không chuyển bài/luồng/tác giả khi sửa (chỉ nội dung, ẩn).
CREATE OR REPLACE FUNCTION community.comments_fixed() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF NEW.post_id IS DISTINCT FROM OLD.post_id OR NEW.thread_id IS DISTINCT FROM OLD.thread_id
     OR NEW.thread_org IS DISTINCT FROM OLD.thread_org OR NEW.author_user_id IS DISTINCT FROM OLD.author_user_id
     OR NEW.author_org IS DISTINCT FROM OLD.author_org THEN
    RAISE EXCEPTION 'comments: bài/luồng/tác giả bất biến' USING ERRCODE = '23514', CONSTRAINT = 'comments_fixed_ck';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION community.comments_fixed() FROM PUBLIC;
--> statement-breakpoint
DROP TRIGGER IF EXISTS comments_fixed ON community.comments;
--> statement-breakpoint
CREATE TRIGGER comments_fixed BEFORE UPDATE ON community.comments
  FOR EACH ROW EXECUTE FUNCTION community.comments_fixed();

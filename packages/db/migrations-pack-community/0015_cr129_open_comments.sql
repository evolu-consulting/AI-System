-- CR-129 · bình luận mở theo bạn bè + nhắc đối tác. Bỏ khái niệm "luồng" (bài × công ty, D3): mỗi bài một danh sách bình luận
-- phẳng. Ai thấy bình luận: chủ quản thấy tất cả; đối tác thấy bình luận của chủ quản + của chính công ty mình + mọi bình luận
-- trên bài của chính mình + bình luận nhắc (@) tới mình; không thấy đối tác khác, không thấy bình luận bị ẩn. Nhắc = mảng
-- `mention_orgs` NGAY trong hàng bình luận (một nguồn, policy không join). Chưa có khách dùng thật ⇒ gỡ thẳng, không backfill.
-- Mạng sao: "bạn" = cùng bên (`ext_org_id`) hoặc một phía là chủ quản (NULL); hàm `sides_friend` là điểm đổi duy nhất nếu sau
-- này mở kết bạn đối tác↔đối tác (trùng `domain/comment-visibility.rules.ts`).
CREATE OR REPLACE FUNCTION community.sides_friend(a uuid, b uuid) RETURNS boolean
  LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog, pg_temp AS $$
  SELECT a IS NOT DISTINCT FROM b OR a IS NULL OR b IS NULL
$$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION community.sides_friend(uuid, uuid) TO community_rw;
--> statement-breakpoint
-- Policy cũ tham chiếu `threads` ⇒ gỡ trước khi bỏ bảng/cột.
DROP POLICY IF EXISTS comments_visible ON community.comments;
--> statement-breakpoint
DROP POLICY IF EXISTS comments_insert ON community.comments;
--> statement-breakpoint
DROP POLICY IF EXISTS comments_update ON community.comments;
--> statement-breakpoint
DROP POLICY IF EXISTS threads_visible ON community.threads;
--> statement-breakpoint
ALTER TABLE community.comments DROP CONSTRAINT IF EXISTS comments_author_ck;
--> statement-breakpoint
ALTER TABLE community.comments DROP CONSTRAINT IF EXISTS comments_thread_fk;
--> statement-breakpoint
DROP INDEX IF EXISTS community.comments_post_idx;
--> statement-breakpoint
DROP INDEX IF EXISTS community.comments_thread_idx;
--> statement-breakpoint
ALTER TABLE community.comments DROP COLUMN IF EXISTS thread_id;
--> statement-breakpoint
ALTER TABLE community.comments DROP COLUMN IF EXISTS thread_org;
--> statement-breakpoint
DROP TABLE IF EXISTS community.threads;
--> statement-breakpoint
ALTER TABLE community.comments ADD COLUMN IF NOT EXISTS mention_orgs uuid[] NOT NULL DEFAULT '{}';
--> statement-breakpoint
ALTER TABLE community.comments ADD CONSTRAINT comments_mentions_ck CHECK (cardinality(mention_orgs) <= 10);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS comments_post_at_idx ON community.comments (post_id, created_at, id);
--> statement-breakpoint
-- Bài/tác giả/lời nhắc bất biến khi sửa (sửa chữ không đổi tag ⇒ không phát chuông lại).
CREATE OR REPLACE FUNCTION community.comments_fixed() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF NEW.post_id IS DISTINCT FROM OLD.post_id OR NEW.author_user_id IS DISTINCT FROM OLD.author_user_id
     OR NEW.author_org IS DISTINCT FROM OLD.author_org OR NEW.mention_orgs IS DISTINCT FROM OLD.mention_orgs THEN
    RAISE EXCEPTION 'comments: bài/tác giả/lời nhắc bất biến' USING ERRCODE = '23514', CONSTRAINT = 'comments_fixed_ck';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
-- Đọc: chủ quản/việc nền tất cả; đối tác: không bị ẩn, trên bài mình thấy (RLS posts), và (tác giả là bạn | bài của mình | được nhắc).
CREATE POLICY comments_visible ON community.comments AS RESTRICTIVE FOR SELECT TO community_rw
  USING ((SELECT packs.viewer_ext_org()) IS NULL OR (NOT hidden
    AND EXISTS (SELECT 1 FROM community.posts p WHERE p.id = comments.post_id AND p.tenant_id = comments.tenant_id
      AND (community.sides_friend(comments.author_org, (SELECT packs.viewer_ext_org()))
        OR p.author_org = (SELECT packs.viewer_ext_org())
        OR (SELECT packs.viewer_ext_org()) = ANY (comments.mention_orgs)))));
--> statement-breakpoint
-- Ghi: đúng bên mình, trên bài mình thấy; chỉ nhắc được BẠN (không nhắc chính bên mình). Đối tác hôm nay không nhắc được ai.
CREATE POLICY comments_insert ON community.comments AS RESTRICTIVE FOR INSERT TO community_rw
  WITH CHECK (coalesce(current_setting('app.user_id', true), '') = ''
    OR (author_org IS NOT DISTINCT FROM (SELECT packs.viewer_ext_org())
      AND EXISTS (SELECT 1 FROM community.posts p WHERE p.id = comments.post_id AND p.tenant_id = comments.tenant_id)
      AND NOT EXISTS (SELECT 1 FROM unnest(comments.mention_orgs) m
        WHERE m IS NOT DISTINCT FROM comments.author_org OR NOT community.sides_friend(comments.author_org, m))));
--> statement-breakpoint
-- Sửa/ẩn: chủ quản, hoặc chính người viết (đối tác).
CREATE POLICY comments_update ON community.comments AS RESTRICTIVE FOR UPDATE TO community_rw
  USING ((SELECT packs.viewer_ext_org()) IS NULL OR (author_org = (SELECT packs.viewer_ext_org())
    AND author_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid))
  WITH CHECK ((SELECT packs.viewer_ext_org()) IS NULL OR author_org = (SELECT packs.viewer_ext_org()));

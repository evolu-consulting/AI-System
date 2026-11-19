-- CR-191 · lát cr191-cross-comment (community 0032) · BR-191-12: người của công ty ĐÃ KẾT NỐI bình luận bài đối tác họ thấy trên bảng tin.
-- Ghi/đọc chéo tenant CHỈ qua hàm DEFINER dưới đây; KHÔNG nới chính sách nào (comments_visible chỉ CHẶT hơn: đối tác ngoài cộng đồng không
-- thấy bình luận của người công ty khác).
-- • Hàng bình luận chéo nằm ở tenant của BÀI (`tenant_id` = công ty đăng) ⇒ người công ty đăng thấy/ẩn/xoá như bình luận nội bộ (RLS cũ);
--   `author_tenant` = công ty của người viết (NULL = cùng tenant như trước), `author_company` = tên công ty chụp lúc viết.
-- • Hàng rào (kiểm lại MỖI lần gọi, cùng luật `feed_connected` 0026 + bảng chân trị `audience-truth.ts`): người xem nội bộ (GUC
--   `app.tenant_id`/`app.user_id`, không từ tham số; người dùng ngoài ⇒ 42501); công ty đăng ∈ `hub.cc_connected_ids()` (hai chiều, không chặn)
--   + bật add-on Bảng tin; bài chủ quản, active, không ẩn, chưa hết hạn, đã duyệt; «Ai thấy bài»: all / companies ∋ tenant người xem /
--   suppliers-buyers theo vai MST đã xác minh không trùng; internal/cats ⇒ không.
-- • Người công ty B thấy trên bài A: bình luận người nội bộ A (author_org NULL, không phải đối tác cộng đồng) + bình luận của công ty B;
--   không thấy bình luận công ty kết nối khác, của đối tác cộng đồng A, bị ẩn. Chữ của A trả bản ĐÃ CHE; người được nhắc chỉ người A/B.
-- • «@» trong bình luận chéo: chỉ người nội bộ của công ty đăng hoặc công ty mình (không lộ công ty kết nối khác).
-- Prod có khách: chỉ thêm cột NULL (không backfill) + hàm mới + thay một chính sách đọc (chặt hơn) + trigger thêm cột bất biến.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
ALTER TABLE community.comments ADD COLUMN IF NOT EXISTS author_tenant uuid;
--> statement-breakpoint
ALTER TABLE community.comments ADD COLUMN IF NOT EXISTS author_company text;
--> statement-breakpoint
-- Ghi qua RLS (đường thường) KHÔNG đặt được `author_tenant` (chỉ DEFINER `cross_comment_add` ghi bình luận chéo). Còn lại giữ nguyên điều kiện 0017.
DROP POLICY IF EXISTS comments_insert ON community.comments;
--> statement-breakpoint
CREATE POLICY comments_insert ON community.comments AS RESTRICTIVE FOR INSERT TO community_rw
  WITH CHECK (comments.author_tenant IS NULL AND (coalesce(current_setting('app.user_id', true), '') = ''
    OR (author_org IS NOT DISTINCT FROM (SELECT packs.viewer_ext_org())
      AND EXISTS (SELECT 1 FROM community.posts p WHERE p.id = comments.post_id AND p.tenant_id = comments.tenant_id)
      AND NOT EXISTS (SELECT 1 FROM unnest(comments.mention_orgs) m
        WHERE m IS NOT DISTINCT FROM comments.author_org
          OR NOT community.sides_friend(comments.author_org, m)
          OR NOT community.mention_target_ok(comments.post_id, m)))));
--> statement-breakpoint
DROP POLICY IF EXISTS comments_visible ON community.comments;
--> statement-breakpoint
CREATE POLICY comments_visible ON community.comments AS RESTRICTIVE FOR SELECT TO community_rw
  USING ((SELECT packs.viewer_ext_org()) IS NULL OR (NOT hidden AND comments.author_tenant IS NULL
    AND EXISTS (SELECT 1 FROM community.posts p WHERE p.id = comments.post_id AND p.tenant_id = comments.tenant_id
      AND (community.sides_friend(comments.author_org, (SELECT packs.viewer_ext_org()))
        OR p.author_org = (SELECT packs.viewer_ext_org())
        OR (SELECT packs.viewer_ext_org()) = ANY (comments.mention_orgs)))));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION community.comments_fixed() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF NEW.post_id IS DISTINCT FROM OLD.post_id OR NEW.author_user_id IS DISTINCT FROM OLD.author_user_id
     OR NEW.author_org IS DISTINCT FROM OLD.author_org OR NEW.mention_orgs IS DISTINCT FROM OLD.mention_orgs
     OR NEW.author_tenant IS DISTINCT FROM OLD.author_tenant OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'comments: bài/tác giả/lời nhắc bất biến' USING ERRCODE = '23514', CONSTRAINT = 'comments_fixed_ck';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
-- Hàng rào: tenant công ty đăng nếu người xem (GUC) thấy bài `p_post` qua kết nối; không ⇒ NULL. Cấp cho community_rw (chỉ lộ id công ty
-- đăng của bài người xem đã thấy trên bảng tin) — dùng cho gợi ý «@» trong bình luận bài công ty kết nối.
CREATE OR REPLACE FUNCTION community.cross_post_tenant(p_post uuid) RETURNS uuid
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_tid uuid := NULLIF(current_setting('app.tenant_id', true), '')::uuid;
  v_uid uuid := NULLIF(current_setting('app.user_id', true), '')::uuid;
  v_t uuid;
BEGIN
  IF v_tid IS NULL OR v_uid IS NULL THEN
    RAISE EXCEPTION 'cross_comment: chưa đặt người xem' USING ERRCODE = '42501';
  END IF;
  IF coalesce(current_setting('app.user_kind', true), '') = 'external' THEN
    RAISE EXCEPTION 'cross_comment: người dùng ngoài' USING ERRCODE = '42501';
  END IF;
  SELECT y.tenant_id INTO v_t FROM community.posts y
   WHERE y.id = p_post AND y.tenant_id <> v_tid
     AND y.tenant_id IN (SELECT c.t FROM hub.cc_connected_ids() AS c(t))
     AND EXISTS (SELECT 1 FROM admin.feature_entitlements e JOIN admin.features f ON f.id = e.feature_id
                  WHERE e.tenant_id = y.tenant_id AND e.revoked_at IS NULL AND f.key = 'contracts-community' AND f.status <> 'off')
     AND y.author_org IS NULL AND y.status = 'active' AND NOT y.hidden AND y.expires_at > now()
     AND y.moderation IN ('none', 'approved')
     AND (y.aud_mode = 'all'
       OR (y.aud_mode = 'companies' AND v_tid = ANY (y.aud_tenants))
       OR (y.aud_mode IN ('suppliers', 'buyers') AND EXISTS (
             SELECT 1 FROM admin.tenants vt JOIN contracts.partner_roles r
                 ON r.tenant_id = y.tenant_id AND r.party_key = 'tax:' || regexp_replace(vt.tax_code, '[^0-9]', '', 'g')
              WHERE vt.id = v_tid AND vt.tax_code IS NOT NULL AND vt.directory_verified_at IS NOT NULL
                AND NOT EXISTS (SELECT 1 FROM admin.tenants o WHERE o.tax_code = vt.tax_code AND o.id <> vt.id)
                AND r.role = CASE y.aud_mode WHEN 'suppliers' THEN 'supplier' ELSE 'customer' END)));
  RETURN v_t;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION community.cross_post_tenant(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION community.cross_post_tenant(uuid) TO community_rw;
--> statement-breakpoint
-- Một bình luận dạng JSON cho người xem công ty `p_me` trên bài của công ty `p_t` (tên `p_tname`). Nội bộ, KHÔNG cấp cho community_rw.
CREATE OR REPLACE FUNCTION community.cross_comment_json(c community.comments, p_me uuid, p_t uuid, p_tname text) RETURNS json
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT json_build_object('id', c.id, 'author_user_id', c.author_user_id, 'author_name', c.author_name, 'author_org', NULL,
    'author_tenant', coalesce(c.author_tenant, p_t), 'author_company', CASE WHEN c.author_tenant IS NULL THEN p_tname ELSE c.author_company END,
    'text', CASE WHEN c.author_tenant = p_me THEN c.text_raw ELSE c.text_masked END, 'hits', NULL, 'hidden', false,
    'created_at', c.created_at, 'mentions', '[]'::json,
    'mention_people', (SELECT coalesce(json_agg(e), '[]'::json) FROM jsonb_array_elements(c.mention_people) e
      WHERE e ->> 'org' IS NULL AND (e ->> 'tenant' IS NULL OR (e ->> 'tenant')::uuid IN (p_t, p_me))))
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION community.cross_comment_json(community.comments, uuid, uuid, text) FROM PUBLIC;
--> statement-breakpoint
-- Đọc: một trang bình luận người xem thấy trên bài công ty kết nối. Trả {post, before_ok, comments}; không thấy bài ⇒ post=false, rỗng.
CREATE OR REPLACE FUNCTION community.cross_comments(
  p_post uuid, p_cur_t timestamptz, p_cur_id uuid, p_limit integer, p_desc boolean, p_before uuid
) RETURNS json
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_tid uuid := NULLIF(current_setting('app.tenant_id', true), '')::uuid;
  v_t uuid := community.cross_post_tenant(p_post);
  v_lim integer := least(greatest(coalesce(p_limit, 50), 1), 101);
  v_name text;
  v_bt timestamptz;
  v_bid uuid;
  v_out json;
BEGIN
  IF v_t IS NULL THEN
    RETURN json_build_object('post', false, 'before_ok', true, 'comments', '[]'::json);
  END IF;
  SELECT coalesce(nullif(btrim(t.legal_name), ''), t.name) INTO v_name FROM admin.tenants t WHERE t.id = v_t;
  IF p_before IS NOT NULL THEN
    SELECT b.created_at, b.id INTO v_bt, v_bid FROM community.comments b
     WHERE b.id = p_before AND b.post_id = p_post AND b.tenant_id = v_t AND NOT b.hidden
       AND ((b.author_tenant IS NULL AND b.author_org IS NULL) OR b.author_tenant = v_tid);
    IF NOT FOUND THEN
      RETURN json_build_object('post', true, 'before_ok', false, 'comments', '[]'::json);
    END IF;
  END IF;
  SELECT coalesce(json_agg(community.cross_comment_json(s, v_tid, v_t, v_name)
           ORDER BY CASE WHEN p_desc THEN NULL ELSE s.created_at END, CASE WHEN p_desc THEN NULL ELSE s.id END,
                    s.created_at DESC, s.id DESC), '[]'::json) INTO v_out
    FROM (SELECT c.* FROM community.comments c
           WHERE c.post_id = p_post AND c.tenant_id = v_t AND NOT c.hidden
             AND ((c.author_tenant IS NULL AND c.author_org IS NULL) OR c.author_tenant = v_tid)
             AND (p_cur_t IS NULL OR (CASE WHEN p_desc THEN (c.created_at, c.id) < (p_cur_t, p_cur_id)
                                          ELSE (c.created_at, c.id) > (p_cur_t, p_cur_id) END))
             AND (p_before IS NULL OR (c.created_at, c.id) < (v_bt, v_bid))
           ORDER BY CASE WHEN p_desc THEN NULL ELSE c.created_at END, CASE WHEN p_desc THEN NULL ELSE c.id END,
                    c.created_at DESC, c.id DESC
           LIMIT v_lim) s;
  RETURN json_build_object('post', true, 'before_ok', true, 'comments', v_out);
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION community.cross_comments(uuid, timestamptz, uuid, integer, boolean, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION community.cross_comments(uuid, timestamptz, uuid, integer, boolean, uuid) TO community_rw;
--> statement-breakpoint
-- Bảng tin: số bình luận + 3 mới nhất (mới → cũ) của các bài công ty kết nối (≤ 101 bài, MỘT lời gọi trong cùng câu bảng tin).
-- Bài người xem không thấy ⇒ không có hàng.
CREATE OR REPLACE FUNCTION community.cross_comment_digest(p_posts uuid[])
RETURNS TABLE (post_id uuid, n integer, recent json)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  WITH me AS (SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid AS tid),
  seen AS (
    SELECT x.p, community.cross_post_tenant(x.p) AS t FROM unnest(p_posts[1:101]) AS x(p)
  )
  SELECT s.p, (SELECT count(*)::int FROM community.comments c
                WHERE c.post_id = s.p AND c.tenant_id = s.t AND NOT c.hidden
                  AND ((c.author_tenant IS NULL AND c.author_org IS NULL) OR c.author_tenant = me.tid)),
    (SELECT json_agg(community.cross_comment_json(r, me.tid, s.t, tn.nm) ORDER BY r.created_at DESC, r.id DESC)
       FROM (SELECT c.* FROM community.comments c
              WHERE c.post_id = s.p AND c.tenant_id = s.t AND NOT c.hidden
                AND ((c.author_tenant IS NULL AND c.author_org IS NULL) OR c.author_tenant = me.tid)
              ORDER BY c.created_at DESC, c.id DESC LIMIT 3) r)
    FROM seen s CROSS JOIN me
    CROSS JOIN LATERAL (SELECT coalesce(nullif(btrim(t.legal_name), ''), t.name) AS nm FROM admin.tenants t WHERE t.id = s.t) tn
   WHERE s.t IS NOT NULL
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION community.cross_comment_digest(uuid[]) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION community.cross_comment_digest(uuid[]) TO community_rw;
--> statement-breakpoint
-- Ghi: bình luận mới của người xem trên bài công ty kết nối. Tên tác giả + công ty lấy từ DB (không từ tham số). `p_people` =
-- [{id, tenant}] — chỉ người nội bộ còn dùng được của công ty đăng hoặc công ty mình (≤ 10); sai ⇒ 22023. Không thấy bài ⇒ 42501.
-- Trả {comment (JSON như cross_comments), post_tenant, people [{id, name, tenant}]}.
CREATE OR REPLACE FUNCTION community.cross_comment_add(
  p_post uuid, p_raw text, p_masked text, p_hits jsonb, p_people jsonb
) RETURNS json
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_tid uuid := NULLIF(current_setting('app.tenant_id', true), '')::uuid;
  v_uid uuid := NULLIF(current_setting('app.user_id', true), '')::uuid;
  v_t uuid := community.cross_post_tenant(p_post);
  v_people jsonb;
  v_name text;
  v_me text;
  v_row community.comments;
BEGIN
  IF v_t IS NULL THEN
    RAISE EXCEPTION 'cross_comment: không thấy bài' USING ERRCODE = '42501';
  END IF;
  SELECT u.display_name INTO v_me FROM admin.users u
   WHERE u.id = v_uid AND u.tenant_id = v_tid AND u.kind = 'internal' AND u.active AND NOT u.locked_by_tenant;
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'cross_comment: người viết không hợp lệ' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(coalesce(p_people, '[]'::jsonb)) <> 'array' OR jsonb_array_length(coalesce(p_people, '[]'::jsonb)) > 10 THEN
    RAISE EXCEPTION 'cross_comment: danh sách nhắc không hợp lệ' USING ERRCODE = '22023';
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'name', u.display_name, 'org', NULL,
           'tenant', CASE WHEN u.tenant_id = v_t THEN NULL ELSE u.tenant_id END) ORDER BY e.ord), '[]'::jsonb)
    INTO v_people
    FROM jsonb_array_elements(coalesce(p_people, '[]'::jsonb)) WITH ORDINALITY AS e(x, ord)
    LEFT JOIN admin.users u ON u.id = (e.x ->> 'id')::uuid AND u.tenant_id = (e.x ->> 'tenant')::uuid
     AND u.tenant_id IN (v_t, v_tid) AND u.kind = 'internal' AND u.active AND NOT u.locked_by_tenant
   HAVING count(u.id) = count(*);
  IF v_people IS NULL THEN
    RAISE EXCEPTION 'cross_comment: nhắc người không thấy bài' USING ERRCODE = '22023';
  END IF;
  SELECT coalesce(nullif(btrim(t.legal_name), ''), t.name) INTO v_name FROM admin.tenants t WHERE t.id = v_tid;
  INSERT INTO community.comments (tenant_id, post_id, author_user_id, author_name, author_org, author_tenant, author_company,
    text_raw, text_masked, hits, mention_orgs, mention_people)
  VALUES (v_t, p_post, v_uid, v_me, NULL, v_tid, v_name, p_raw, p_masked, coalesce(p_hits, '[]'::jsonb), '{}', v_people)
  RETURNING * INTO v_row;
  RETURN json_build_object('comment', community.cross_comment_json(v_row, v_tid, v_t,
      (SELECT coalesce(nullif(btrim(t.legal_name), ''), t.name) FROM admin.tenants t WHERE t.id = v_t)),
    'post_tenant', v_t, 'people', v_people);
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION community.cross_comment_add(uuid, text, text, jsonb, jsonb) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION community.cross_comment_add(uuid, text, text, jsonb, jsonb) TO community_rw;
--> statement-breakpoint
-- Sửa chữ bình luận CỦA CHÍNH MÌNH trên bài công ty kết nối (hàng rào còn hiệu lực). Không phải của mình / không thấy bài ⇒ NULL.
CREATE OR REPLACE FUNCTION community.cross_comment_edit(p_post uuid, p_id uuid, p_raw text, p_masked text, p_hits jsonb)
RETURNS json
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_tid uuid := NULLIF(current_setting('app.tenant_id', true), '')::uuid;
  v_uid uuid := NULLIF(current_setting('app.user_id', true), '')::uuid;
  v_t uuid := community.cross_post_tenant(p_post);
  v_row community.comments;
BEGIN
  IF v_t IS NULL THEN RETURN NULL; END IF;
  UPDATE community.comments c SET text_raw = p_raw, text_masked = p_masked, hits = coalesce(p_hits, '[]'::jsonb)
   WHERE c.id = p_id AND c.post_id = p_post AND c.tenant_id = v_t AND c.author_tenant = v_tid AND c.author_user_id = v_uid
     AND NOT c.hidden
  RETURNING * INTO v_row;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN community.cross_comment_json(v_row, v_tid, v_t,
    (SELECT coalesce(nullif(btrim(t.legal_name), ''), t.name) FROM admin.tenants t WHERE t.id = v_t));
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION community.cross_comment_edit(uuid, uuid, text, text, jsonb) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION community.cross_comment_edit(uuid, uuid, text, text, jsonb) TO community_rw;
--> statement-breakpoint
-- Xoá bình luận CỦA CHÍNH MÌNH trên bài công ty kết nối (hàng rào còn hiệu lực). true = đã xoá.
CREATE OR REPLACE FUNCTION community.cross_comment_delete(p_post uuid, p_id uuid) RETURNS boolean
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_tid uuid := NULLIF(current_setting('app.tenant_id', true), '')::uuid;
  v_uid uuid := NULLIF(current_setting('app.user_id', true), '')::uuid;
  v_t uuid := community.cross_post_tenant(p_post);
BEGIN
  IF v_t IS NULL THEN RETURN false; END IF;
  DELETE FROM community.comments c
   WHERE c.id = p_id AND c.post_id = p_post AND c.tenant_id = v_t AND c.author_tenant = v_tid AND c.author_user_id = v_uid;
  RETURN FOUND;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION community.cross_comment_delete(uuid, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION community.cross_comment_delete(uuid, uuid) TO community_rw;

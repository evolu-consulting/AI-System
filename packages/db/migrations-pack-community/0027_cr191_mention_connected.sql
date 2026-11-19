-- CR-191 · lát cr191-composer-audience · BR-191-7/8: nhắc NGƯỜI của công ty ĐÃ KẾT NỐI nằm trong «Ai thấy bài».
-- Ghi chéo tenant ⇒ chỉ qua hàm DEFINER (không nới RLS `posts_*`/`post_mentions_*` cho người ngoài):
-- • `community.connected_audience(mode, tenants)` — mỗi công ty ĐÃ KẾT NỐI của tenant hiện tại (`hub.cc_connected_ids()`, kiểm lại mỗi lần ⇒
--   ngắt là mất ngay) kèm cờ `sees` = công ty đó thấy bài với «Ai thấy bài» này. Cùng luật `feed_connected` (0026) và bảng chân trị
--   `audience-truth.ts`: all ⇒ có; companies ⇒ ∈ tenants; suppliers/buyers ⇒ vai trong `contracts.partner_roles` (MST đã xác minh, không trùng);
--   internal/cats ⇒ không. Dùng cho «n/N công ty đối tác thấy bài», danh sách «Chọn công ty…» và gợi ý «@».
-- • `community.mention_tenants_ok(post, tenants)` — trong `tenants`, công ty nào được nhắc người trên BÀI này (bài chủ quản của tenant hiện
--   tại, `sees`). Service gọi trong cùng tx ghi bài; ngoài tập ⇒ 422 và rollback cả bài.
-- • `post_mentions.user_tenant` (NULL = người cùng tenant/đối tác như CR-145; có giá trị = người công ty kết nối). Đối tác ngoài KHÔNG thấy
--   dòng có `user_tenant` (chính sách `post_mentions_visible` thêm điều kiện) ⇒ không lộ tên người công ty khác.
-- Prod có khách: chỉ thêm cột (NULL, không backfill) + hàm mới + thay một chính sách đọc (chặt hơn).
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
ALTER TABLE community.post_mentions ADD COLUMN IF NOT EXISTS user_tenant uuid;
--> statement-breakpoint
DROP POLICY IF EXISTS post_mentions_visible ON community.post_mentions;
--> statement-breakpoint
CREATE POLICY post_mentions_visible ON community.post_mentions AS RESTRICTIVE FOR SELECT TO community_rw
  USING ((SELECT packs.viewer_ext_org()) IS NULL OR (
    post_mentions.user_tenant IS NULL
    AND (post_mentions.user_org IS NULL OR post_mentions.user_org = (SELECT packs.viewer_ext_org()))
    AND EXISTS (SELECT 1 FROM community.posts p
      WHERE p.id = post_mentions.post_id AND p.tenant_id = post_mentions.tenant_id)));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION community.connected_audience(p_mode text, p_tenants uuid[])
RETURNS TABLE (tenant_id uuid, company_name text, sees boolean)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_tid uuid := NULLIF(current_setting('app.tenant_id', true), '')::uuid;
  v_uid uuid := NULLIF(current_setting('app.user_id', true), '')::uuid;
BEGIN
  IF v_tid IS NULL OR v_uid IS NULL THEN
    RAISE EXCEPTION 'connected_audience: chưa đặt người xem' USING ERRCODE = '42501';
  END IF;
  IF coalesce(current_setting('app.user_kind', true), '') = 'external' THEN
    RAISE EXCEPTION 'connected_audience: người dùng ngoài' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT c.t, coalesce(nullif(btrim(ot.legal_name), ''), ot.name),
    CASE p_mode
      WHEN 'all' THEN true
      WHEN 'companies' THEN c.t = ANY (coalesce(p_tenants, '{}'))
      WHEN 'suppliers' THEN EXISTS (SELECT 1 FROM contracts.partner_roles r
          WHERE r.tenant_id = v_tid AND r.role = 'supplier' AND ot.tax_code IS NOT NULL AND ot.directory_verified_at IS NOT NULL
            AND r.party_key = 'tax:' || regexp_replace(ot.tax_code, '[^0-9]', '', 'g')
            AND NOT EXISTS (SELECT 1 FROM admin.tenants o2 WHERE o2.tax_code = ot.tax_code AND o2.id <> ot.id))
      WHEN 'buyers' THEN EXISTS (SELECT 1 FROM contracts.partner_roles r
          WHERE r.tenant_id = v_tid AND r.role = 'customer' AND ot.tax_code IS NOT NULL AND ot.directory_verified_at IS NOT NULL
            AND r.party_key = 'tax:' || regexp_replace(ot.tax_code, '[^0-9]', '', 'g')
            AND NOT EXISTS (SELECT 1 FROM admin.tenants o2 WHERE o2.tax_code = ot.tax_code AND o2.id <> ot.id))
      ELSE false
    END
  FROM hub.cc_connected_ids() AS c(t) JOIN admin.tenants ot ON ot.id = c.t
  ORDER BY 2, 1 LIMIT 200;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION community.connected_audience(text, uuid[]) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION community.connected_audience(text, uuid[]) TO community_rw;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION community.mention_tenants_ok(p_post uuid, p_tenants uuid[])
RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT ca.tenant_id FROM community.posts p
    CROSS JOIN LATERAL community.connected_audience(p.aud_mode, p.aud_tenants) ca
   WHERE p.id = p_post AND p.tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
     AND p.author_org IS NULL AND ca.sees AND ca.tenant_id = ANY (p_tenants)
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION community.mention_tenants_ok(uuid, uuid[]) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION community.mention_tenants_ok(uuid, uuid[]) TO community_rw;

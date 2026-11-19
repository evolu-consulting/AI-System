-- CR-191 · lát cr191-cross-person-card · BR-191-13: `community.feed_connected` trả THÊM `author_user_id` (mã người đăng bài công ty ĐÃ KẾT NỐI) để web lấy ảnh thật
-- qua `GET /people?ids=` (hub 0171 `cc_person_cards`, tự kiểm kết nối). CHỈ THÊM một cột trả ra: mọi hàng rào của 0026 giữ NGUYÊN (GUC người xem, người dùng ngoài 42501,
-- công ty ∈ `cc_connected_ids`, add-on, «Ai thấy bài», bản đã che). Đổi kiểu trả về ⇒ DROP + CREATE (cùng chữ ký tham số) rồi cấp lại quyền.
DROP FUNCTION IF EXISTS community.feed_connected(timestamptz, uuid, integer, text, uuid);
--> statement-breakpoint
CREATE FUNCTION community.feed_connected(
  p_cur_t timestamptz, p_cur_id uuid, p_limit integer, p_type text, p_source uuid
) RETURNS TABLE (id uuid, tenant_id uuid, company_name text, type text, title_masked text, body_masked text,
                 fields_masked jsonb, cats text[], edited boolean, created_at timestamptz, expires_at timestamptz,
                 file_count integer, author_name text, author_title text, author_user_id uuid)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
#variable_conflict use_column
DECLARE
  v_tid uuid := NULLIF(current_setting('app.tenant_id', true), '')::uuid;
  v_uid uuid := NULLIF(current_setting('app.user_id', true), '')::uuid;
  v_lim integer := least(greatest(coalesce(p_limit, 20), 1), 101);
BEGIN
  IF v_tid IS NULL OR v_uid IS NULL THEN
    RAISE EXCEPTION 'feed_connected: chưa đặt người xem' USING ERRCODE = '42501';
  END IF;
  IF coalesce(current_setting('app.user_kind', true), '') = 'external' THEN
    RAISE EXCEPTION 'feed_connected: người dùng ngoài' USING ERRCODE = '42501';
  END IF;
  IF p_type IS NOT NULL AND p_type NOT IN ('sell', 'buy', 'note') THEN
    RAISE EXCEPTION 'feed_connected: loại bài không hợp lệ' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  WITH mine AS (
    -- công ty đã kết nối còn bật Bảng tin (một lần mỗi công ty, không theo bài)
    SELECT c.t FROM hub.cc_connected_ids() AS c(t)
     WHERE (p_source IS NULL OR c.t = p_source)
       AND EXISTS (SELECT 1 FROM admin.feature_entitlements e JOIN admin.features f ON f.id = e.feature_id
                    WHERE e.tenant_id = c.t AND e.revoked_at IS NULL AND f.key = 'contracts-community' AND f.status <> 'off')
  ), me AS (
    -- Nhãn NCC/KH chỉ khi công ty người xem ĐÃ ĐƯỢC XÁC MINH và MST không trùng công ty nào khác (chống khai MST giả — soát #2).
    -- `tax_code` có CHECK định dạng `^[0-9]{10}(-[0-9]{3})?$` ⇒ cùng chữ số ⇔ cùng chuỗi.
    SELECT 'tax:' || regexp_replace(vt.tax_code, '[^0-9]', '', 'g') AS pk FROM admin.tenants vt
     WHERE vt.id = v_tid AND vt.tax_code IS NOT NULL AND vt.directory_verified_at IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM admin.tenants o WHERE o.tax_code = vt.tax_code AND o.id <> vt.id)
  )
  , top AS (
    -- mỗi công ty: duyệt `posts_feed_idx (tenant_id, created_at DESC, id DESC)` theo thứ tự, dừng ở v_lim bài thấy được; sắp gộp,
    -- lấy v_lim — chỉ các hàng này mới tra tên công ty / chức vụ / số tệp
    SELECT x.id, x.tenant_id, x.type, x.title_masked, x.body_masked, x.fields_masked, x.cats, x.edited, x.created_at,
           x.expires_at, x.author_name, x.author_user_id
      FROM mine CROSS JOIN LATERAL (
        SELECT y.* FROM community.posts y
         WHERE y.tenant_id = mine.t
           AND (p_cur_t IS NULL OR (y.created_at, y.id) < (p_cur_t, p_cur_id))
           AND y.author_org IS NULL AND y.status = 'active' AND NOT y.hidden AND y.expires_at > now()
           AND y.moderation IN ('none', 'approved')
           AND (p_type IS NULL OR y.type = p_type)
           AND (y.aud_mode = 'all'
             OR (y.aud_mode = 'companies' AND v_tid = ANY (y.aud_tenants))
             OR (y.aud_mode IN ('suppliers', 'buyers') AND EXISTS (
                   SELECT 1 FROM me JOIN contracts.partner_roles r ON r.tenant_id = y.tenant_id AND r.party_key = me.pk
                    WHERE r.role = CASE y.aud_mode WHEN 'suppliers' THEN 'supplier' ELSE 'customer' END)))
         ORDER BY y.created_at DESC, y.id DESC
         LIMIT v_lim) x
     ORDER BY x.created_at DESC, x.id DESC
     LIMIT v_lim
  )
  SELECT p.id, p.tenant_id, coalesce(nullif(btrim(ot.legal_name), ''), ot.name), p.type, p.title_masked, p.body_masked,
         p.fields_masked, p.cats, p.edited, p.created_at, p.expires_at,
         (SELECT count(*) FROM community.media md WHERE md.post_id = p.id AND md.tenant_id = p.tenant_id)::integer,
         p.author_name, pp.job_title, p.author_user_id
    FROM top p
    JOIN admin.tenants ot ON ot.id = p.tenant_id
    LEFT JOIN hub.people_profiles pp ON pp.tenant_id = p.tenant_id AND pp.user_id = p.author_user_id
   ORDER BY p.created_at DESC, p.id DESC;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION community.feed_connected(timestamptz, uuid, integer, text, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION community.feed_connected(timestamptz, uuid, integer, text, uuid) TO community_rw;

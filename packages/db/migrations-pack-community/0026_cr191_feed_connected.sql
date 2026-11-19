-- CR-191 · lát cr191-feed-merge-rls · BR-191-1/2/3: bảng tin GỘP — phần bài của công ty ĐÃ KẾT NỐI. RLS `posts_tenant`/`posts_visible`
-- KHÔNG đổi: đường đọc chéo công ty duy nhất là hàm DEFINER dưới đây (thay `community.cc_posts` của CR-161, gỡ cùng lát — G1).
-- • tenant/người xem lấy từ GUC (`app.tenant_id`, `app.user_id`), không từ tham số; thiếu ⇒ 42501; người dùng ngoài ⇒ 42501.
-- • công ty đăng ∈ `hub.cc_connected_ids()` (hub 0163, kiểm lại MỖI lần gọi ⇒ ngắt/chặn là mất ngay), bật add-on Bảng tin.
-- • chỉ bài chủ quản (`author_org IS NULL`), `active`, không ẩn, chưa hết hạn, không đang chờ/bị từ chối duyệt.
-- • «Ai thấy bài» cho công ty người xem: `all` ⇒ có; `suppliers`/`buyers` ⇒ công ty người xem có vai `supplier`/`customer` trong sổ đối tác
--   của bên đăng (`contracts.partner_roles.party_key = 'tax:' || chữ số MST` — Q2), CHỈ khi công ty người xem đã được nền tảng xác minh
--   (`directory_verified_at`) và MST không trùng công ty khác; không đạt ⇒ không nhãn; `companies` ⇒ tenant người xem
--   ∈ `aud_tenants` (id ext_org ở `aud_orgs` không áp chéo); `internal`/`cats` ⇒ không. Khớp bảng chân trị
--   `tests/acceptance/com-c3/_support/audience-truth.ts` (hàng `connected`).
-- • trả bản ĐÃ CHE + số tệp + tên công ty + tên/chức vụ người đăng; KHÔNG trả *_raw, hits, aud_*, status, hidden, url/file_id.
-- • MỘT câu; keyset (created_at, id) DESC; mỗi công ty LATERAL trên posts_feed_idx rồi sắp gộp; p_limit kẹp 1..101 (route xin limit+1).
-- • `job_title` ≤ 80 ký tự do CHECK `people_profiles_title_ck` (khớp contract `authorTitle.max(80)`) ⇒ không cần cắt.
CREATE OR REPLACE FUNCTION community.feed_connected(
  p_cur_t timestamptz, p_cur_id uuid, p_limit integer, p_type text, p_source uuid
) RETURNS TABLE (id uuid, tenant_id uuid, company_name text, type text, title_masked text, body_masked text,
                 fields_masked jsonb, cats text[], edited boolean, created_at timestamptz, expires_at timestamptz,
                 file_count integer, author_name text, author_title text)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
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
         p.author_name, pp.job_title
    FROM top p
    JOIN admin.tenants ot ON ot.id = p.tenant_id
    LEFT JOIN hub.people_profiles pp ON pp.tenant_id = p.tenant_id AND pp.user_id = p.author_user_id
   ORDER BY p.created_at DESC, p.id DESC;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION community.feed_connected(timestamptz, uuid, integer, text, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION community.feed_connected(timestamptz, uuid, integer, text, uuid) TO community_rw;
--> statement-breakpoint
-- Chức vụ người đăng cho bài CÔNG TY MÌNH (BR-191-3): `community_rw` không có quyền bảng `hub.people_profiles` ⇒ DEFINER một câu theo lô,
-- chỉ hàng của tenant người xem (GUC); người dùng ngoài nhận rỗng (không lỗi — bảng tin của họ vẫn chạy). Lô ≤ 200 id.
CREATE OR REPLACE FUNCTION community.author_titles(p_users uuid[])
RETURNS TABLE (user_id uuid, job_title text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT pp.user_id, pp.job_title FROM hub.people_profiles pp
   WHERE pp.tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
     AND coalesce(current_setting('app.user_kind', true), '') <> 'external'
     AND pp.user_id = ANY (p_users[1:200]) AND pp.job_title IS NOT NULL
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION community.author_titles(uuid[]) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION community.author_titles(uuid[]) TO community_rw;
--> statement-breakpoint
-- Cấp lại hàm hub 0163 không điều kiện (role gói đã có khi migration gói chạy — bài học 0021).
GRANT USAGE ON SCHEMA hub TO community_rw;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION hub.cc_connected_ids() TO community_rw;
--> statement-breakpoint
-- G1: gỡ đường cũ «Bảng tin công ty» (CR-161, route `/pack/contracts/connect/posts/:tenant_id` gỡ cùng lát; UI đã gỡ ở CR-169).
DROP FUNCTION IF EXISTS community.cc_posts(uuid, timestamptz, uuid, integer);

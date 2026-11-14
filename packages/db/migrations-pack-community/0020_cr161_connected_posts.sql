-- CR-161 · lát 4 · spec §2 R10 · công ty đã kết nối (A↔B) đọc được bài Bảng tin công khai của nhau: CHỈ chữ + số tệp (Q2: chưa đọc ảnh/tệp).
-- R10: bên đăng (p_owner) phải đang bật Bảng tin = add-on `contracts-community` (admin.feature_entitlements chưa thu hồi) — tắt ⇒ rỗng, không lỗi.
-- RLS `posts_tenant` vẫn khoá theo tenant ⇒ đường đọc chéo công ty duy nhất là hàm DEFINER này (cùng khuôn `mention_target_ok`):
--   • tenant người xem lấy từ GUC `app.tenant_id` (không từ đầu vào); p_owner chính mình / rỗng ⇒ 22023;
--   • `hub.cc_connected(tenant, p_owner)` sai (chưa kết nối, đã ngắt, đã chặn, công ty thứ ba) ⇒ 42501 — ngắt ⇒ mất ngay (mỗi lần gọi kiểm lại);
--   • chỉ bài của B: author_org IS NULL AND aud_mode='all' AND status='active' AND NOT hidden AND expires_at > now();
--   • trả bản ĐÃ CHE (title/body/fields_masked) + file_count; KHÔNG trả *_raw, hits, author_*, aud_*, status, hidden, url/file_id.
-- 2 câu SQL cố định mỗi trang (kiểm kết nối + một SELECT, file_count bằng LATERAL trên media_post_idx); keyset (created_at, id) DESC
-- trên posts_feed_idx; p_limit kẹp 1..101 (route xin limit+1).
CREATE OR REPLACE FUNCTION community.cc_posts(p_owner uuid, p_cur_t timestamptz, p_cur_id uuid, p_limit integer)
RETURNS TABLE (id uuid, type text, title_masked text, body_masked text, fields_masked jsonb, cats text[],
               edited boolean, created_at timestamptz, expires_at timestamptz, file_count integer)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_tid uuid := NULLIF(current_setting('app.tenant_id', true), '')::uuid;
BEGIN
  IF v_tid IS NULL THEN
    RAISE EXCEPTION 'cc_posts: chưa đặt tenant' USING ERRCODE = '42501';
  END IF;
  -- Người dùng ngoài (đối tác) không dùng đường này (khuôn contracts 0067 ext_deny): chặn ở DB kể cả khi lớp cổng bị bỏ sót.
  IF coalesce(current_setting('app.user_kind', true), '') = 'external' THEN
    RAISE EXCEPTION 'cc_posts: người dùng ngoài' USING ERRCODE = '42501';
  END IF;
  IF p_owner IS NULL OR p_owner = v_tid THEN
    RAISE EXCEPTION 'cc_posts: công ty không hợp lệ' USING ERRCODE = '22023';
  END IF;
  IF NOT hub.cc_connected(v_tid, p_owner) THEN
    RAISE EXCEPTION 'cc_posts: chưa kết nối' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT p.id, p.type, p.title_masked, p.body_masked, p.fields_masked, p.cats, p.edited, p.created_at, p.expires_at,
         m.n::integer
    FROM community.posts p
    LEFT JOIN LATERAL (SELECT count(*) AS n FROM community.media md
                        WHERE md.post_id = p.id AND md.tenant_id = p.tenant_id) m ON true
   WHERE p.tenant_id = p_owner
     AND EXISTS (SELECT 1 FROM admin.feature_entitlements e JOIN admin.features f ON f.id = e.feature_id
                  WHERE e.tenant_id = p_owner AND e.revoked_at IS NULL AND f.key = 'contracts-community' AND f.status <> 'off')
     AND p.author_org IS NULL AND p.aud_mode = 'all' AND p.status = 'active' AND NOT p.hidden AND p.expires_at > now()
     AND (p_cur_t IS NULL OR (p.created_at, p.id) < (p_cur_t, p_cur_id))
   ORDER BY p.created_at DESC, p.id DESC
   LIMIT least(greatest(coalesce(p_limit, 20), 1), 101);
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION community.cc_posts(uuid, timestamptz, uuid, integer) FROM PUBLIC;
--> statement-breakpoint
-- community_rw (đường cũ) + contracts_rw (route kết nối nằm ở gói contracts; role tạo SAU ⇒ chỉ cấp khi đã có).
DO $$
BEGIN
  GRANT EXECUTE ON FUNCTION community.cc_posts(uuid, timestamptz, uuid, integer) TO community_rw;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'contracts_rw') THEN
    GRANT USAGE ON SCHEMA community TO contracts_rw;
    GRANT EXECUTE ON FUNCTION community.cc_posts(uuid, timestamptz, uuid, integer) TO contracts_rw;
  END IF;
END $$;

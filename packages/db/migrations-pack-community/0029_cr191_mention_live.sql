-- CR-191 · lát cr191-composer-audience (soát Opus #2) · chuông «nhắc bạn» tới người công ty ĐÃ KẾT NỐI phải kiểm lại kết nối + «Ai thấy bài»
-- NGAY LÚC GỬI (kể cả sau duyệt): ngắt kết nối / thu hẹp «Ai thấy bài» trước khi gửi ⇒ không chuông.
-- Biến thể cho tx HỆ THỐNG (gửi chuông chạy nền, không có `app.user_id`): chỉ cần `app.tenant_id` (tenant của bài); người dùng ngoài ⇒ 42501.
-- Cùng luật `community.connected_audience` (0027) và `feed_connected` (0026): all ⇒ có; companies ⇒ ∈ aud_tenants; suppliers/buyers ⇒ vai trong
-- `contracts.partner_roles` (MST đã xác minh, không trùng); internal/cats ⇒ không. Chỉ đọc, DEFINER, không ghi gì.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
CREATE OR REPLACE FUNCTION community.mention_tenants_live(p_post uuid, p_tenants uuid[])
RETURNS SETOF uuid
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_tid uuid := NULLIF(current_setting('app.tenant_id', true), '')::uuid;
BEGIN
  IF v_tid IS NULL THEN
    RAISE EXCEPTION 'mention_tenants_live: chưa đặt tenant' USING ERRCODE = '42501';
  END IF;
  IF coalesce(current_setting('app.user_kind', true), '') = 'external' THEN
    RAISE EXCEPTION 'mention_tenants_live: người dùng ngoài' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT c.t FROM community.posts p
    CROSS JOIN LATERAL hub.cc_connected_ids() AS c(t)
    JOIN admin.tenants ot ON ot.id = c.t
   WHERE p.id = p_post AND p.tenant_id = v_tid AND p.author_org IS NULL AND c.t = ANY (coalesce(p_tenants, '{}'))
     AND CASE p.aud_mode
       WHEN 'all' THEN true
       WHEN 'companies' THEN c.t = ANY (p.aud_tenants)
       WHEN 'suppliers' THEN EXISTS (SELECT 1 FROM contracts.partner_roles r
          WHERE r.tenant_id = v_tid AND r.role = 'supplier' AND ot.tax_code IS NOT NULL AND ot.directory_verified_at IS NOT NULL
            AND r.party_key = 'tax:' || regexp_replace(ot.tax_code, '[^0-9]', '', 'g')
            AND NOT EXISTS (SELECT 1 FROM admin.tenants o2 WHERE o2.tax_code = ot.tax_code AND o2.id <> ot.id))
       WHEN 'buyers' THEN EXISTS (SELECT 1 FROM contracts.partner_roles r
          WHERE r.tenant_id = v_tid AND r.role = 'customer' AND ot.tax_code IS NOT NULL AND ot.directory_verified_at IS NOT NULL
            AND r.party_key = 'tax:' || regexp_replace(ot.tax_code, '[^0-9]', '', 'g')
            AND NOT EXISTS (SELECT 1 FROM admin.tenants o2 WHERE o2.tax_code = ot.tax_code AND o2.id <> ot.id))
       ELSE false END;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION community.mention_tenants_live(uuid, uuid[]) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION community.mention_tenants_live(uuid, uuid[]) TO community_rw;

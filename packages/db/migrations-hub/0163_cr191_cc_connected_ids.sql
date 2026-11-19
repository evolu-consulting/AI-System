-- CR-191 · lát cr191-feed-merge-rls · BR-191-1: id MỌI công ty ĐÃ KẾT NỐI của công ty người xem (`app.tenant_id`), MỘT câu.
-- Cùng điều kiện `hub.cc_connected_raw` (0145): hai chiều, cả hai `accepted_at` có, không chiều nào `blocked_at` ⇒ ngắt/chặn là mất ngay
-- (không cache: hàm đọc bảng mỗi lần gọi). DEFINER vì role gói không có quyền bảng `hub.partner_links`. Tenant lấy từ GUC, không từ tham số.
-- Người dùng ngoài (đối tác cộng đồng, `app.user_kind = external`) không được liệt kê công ty kết nối của chủ quản ⇒ 42501.
CREATE OR REPLACE FUNCTION hub.cc_connected_ids()
RETURNS SETOF uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_tid uuid := NULLIF(current_setting('app.tenant_id', true), '')::uuid;
BEGIN
  IF v_tid IS NULL THEN
    RAISE EXCEPTION 'cc_connected_ids: chưa đặt tenant' USING ERRCODE = '42501';
  END IF;
  IF coalesce(current_setting('app.user_kind', true), '') = 'external' THEN
    RAISE EXCEPTION 'cc_connected_ids: người dùng ngoài' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT l.to_tenant FROM hub.partner_links l
    JOIN hub.partner_links r ON r.from_tenant = l.to_tenant AND r.to_tenant = l.from_tenant
   WHERE l.from_tenant = v_tid AND l.to_tenant <> v_tid
     AND l.accepted_at IS NOT NULL AND l.blocked_at IS NULL
     AND r.accepted_at IS NOT NULL AND r.blocked_at IS NULL;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION hub.cc_connected_ids() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION hub.cc_connected_ids() TO hub_rw;
--> statement-breakpoint
-- Role gói tạo SAU hub trên DB dựng sạch ⇒ cấp có điều kiện ở đây, community 0026 cấp lại không điều kiện (bài học 0021).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'contracts_rw') THEN
    GRANT USAGE ON SCHEMA hub TO contracts_rw;
    GRANT EXECUTE ON FUNCTION hub.cc_connected_ids() TO contracts_rw;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'community_rw') THEN
    GRANT USAGE ON SCHEMA hub TO community_rw;
    GRANT EXECUTE ON FUNCTION hub.cc_connected_ids() TO community_rw;
  END IF;
END $$;

-- CR-191 · lát cr191-cross-person-card · BR-191-13: thẻ người CHÉO công ty (ảnh thật tác giả bài đối tác, «@», danh sách Tin nhắn). CHỈ THÊM hàm mới (prod có khách thật).
-- Nhận ≤ 50 id người; trả CHỈ (user_id, họ tên, chức vụ, ảnh đại diện, tên công ty) cho người thuộc công ty ĐÃ KẾT NỐI với công ty người gọi
-- (`hub.cc_connected_ids()`: hai chiều accepted, không chặn ⇒ ngắt/chặn là mất ngay, không cache). Không trả email/điện thoại/cột khác.
-- Người ngoài phạm vi (công ty chưa kết nối/đã ngắt, người dùng ngoài, id lạ, chính công ty mình — đã có đường cũ `GET /people`) ⇒ BỎ QUA, không lỗi, không lộ tồn tại.
-- Người gọi lấy từ GUC (`app.tenant_id`, `app.user_id`), KHÔNG là tham số; người gọi là người dùng ngoài (GUC hoặc DB) ⇒ rỗng.
-- Chỉ người nội bộ ĐANG HOẠT ĐỘNG của công ty kia (`kind <> 'external'`, `active`, không `locked_by_tenant` — cùng luật `pmsg_eligible_v`): đối tác cộng đồng,
-- người đã ngừng/bị khoá không lộ. Người GỌI cũng phải đang hoạt động (người bị khoá/ngừng ⇒ rỗng).
CREATE OR REPLACE FUNCTION hub.cc_person_cards(p_ids uuid[])
RETURNS TABLE (user_id uuid, display_name text, job_title text, avatar text, company_name text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_tid uuid := NULLIF(current_setting('app.tenant_id', true), '')::uuid;
  v_uid uuid := NULLIF(current_setting('app.user_id', true), '')::uuid;
BEGIN
  IF v_tid IS NULL OR v_uid IS NULL THEN
    RAISE EXCEPTION 'cc_person_cards: chưa đặt người xem' USING ERRCODE = '42501';
  END IF;
  IF coalesce(current_setting('app.user_kind', true), '') = 'external'
     OR NOT EXISTS (SELECT 1 FROM admin.users c WHERE c.id = v_uid AND c.tenant_id = v_tid AND c.active AND NOT c.locked_by_tenant AND c.kind <> 'external') THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT u.id, u.display_name, pp.job_title, pp.avatar, COALESCE(t.legal_name, t.name)
    FROM unnest((COALESCE(p_ids, '{}'::uuid[]))[1:50]) AS i(id)
    JOIN admin.users u ON u.id = i.id AND u.active AND NOT u.locked_by_tenant AND u.kind <> 'external'
    JOIN hub.cc_connected_ids() AS cc(tid) ON cc.tid = u.tenant_id
    JOIN admin.tenants t ON t.id = u.tenant_id
    LEFT JOIN hub.people_profiles pp ON pp.tenant_id = u.tenant_id AND pp.user_id = u.id;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION hub.cc_person_cards(uuid[]) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION hub.cc_person_cards(uuid[]) TO hub_rw;

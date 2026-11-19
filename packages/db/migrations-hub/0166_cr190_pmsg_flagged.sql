-- CR-190 · «đánh dấu chưa đọc» (cờ lưu ở contracts.msg_conv_prefs, pack-contracts 0126) cần hai việc từ phía cuộc `partner` (hub.pmsg_*) mà hàm cũ không làm được.
-- CHỈ THÊM hàm mới, không sửa/xoá hàm hay dữ liệu cũ (prod có khách thật). Khuôn 0153: DEFINER, search_path cố định, người dùng từ `hub.pmsg_ctx()` (KHÔNG là tham số).
-- Mảng id cờ do pack-contracts truyền vào CHỈ làm rộng bộ lọc trong phạm vi cuộc người gọi là một đầu (mọi nhánh vẫn lọc a_user/b_user = người gọi) ⇒ id lạ/của người khác bị bỏ, không lộ.
-- Chạy lại được (CREATE OR REPLACE). Không phụ thuộc bảng contracts (hub không đọc schema contracts).

-- (1) Danh sách cuộc CHỈ chưa đọc, gồm cả cuộc chỉ có cờ: như `pmsg_inbox_unread` (0153) + `OR t.id = ANY(p_flagged)` ở điều kiện «chưa đọc». Thân còn lại giữ nguyên văn.
CREATE OR REPLACE FUNCTION hub.pmsg_inbox_unread(p_company uuid, p_cur_t timestamptz, p_cur_id uuid, p_limit integer, p_flagged uuid[])
RETURNS TABLE (
  id uuid, peer_user uuid, peer_name text, peer_title text, peer_active boolean, company_id uuid, company_name text,
  last jsonb, unread integer, last_at timestamptz, read_only boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_tid uuid;
  v_uid uuid;
  v_lim integer := LEAST(GREATEST(COALESCE(p_limit, 30), 1), 51);
  v_flag uuid[] := COALESCE(p_flagged, '{}'::uuid[]);
BEGIN
  SELECT c.tid, c.uid INTO v_tid, v_uid FROM hub.pmsg_ctx() c;
  RETURN QUERY
  WITH pick AS (
    (SELECT t.id AS tid, t.last_at AS tat FROM hub.pmsg_threads t
      WHERE t.a_tenant = v_tid AND t.a_user = v_uid AND (p_company IS NULL OR t.b_tenant = p_company)
        AND ((t.last_seq > t.a_read_seq
              AND EXISTS (SELECT 1 FROM hub.pmsg_messages x WHERE x.thread_id = t.id AND x.seq > t.a_read_seq AND x.sender_user <> v_uid AND x.deleted_at IS NULL))
             OR t.id = ANY (v_flag))
        AND (p_cur_t IS NULL OR p_cur_id IS NULL OR (t.last_at, t.id) < (p_cur_t, p_cur_id))
      ORDER BY t.last_at DESC, t.id DESC LIMIT v_lim)
    UNION ALL
    (SELECT t.id, t.last_at FROM hub.pmsg_threads t
      WHERE t.b_tenant = v_tid AND t.b_user = v_uid AND (p_company IS NULL OR t.a_tenant = p_company)
        AND ((t.last_seq > t.b_read_seq
              AND EXISTS (SELECT 1 FROM hub.pmsg_messages x WHERE x.thread_id = t.id AND x.seq > t.b_read_seq AND x.sender_user <> v_uid AND x.deleted_at IS NULL))
             OR t.id = ANY (v_flag))
        AND (p_cur_t IS NULL OR p_cur_id IS NULL OR (t.last_at, t.id) < (p_cur_t, p_cur_id))
      ORDER BY t.last_at DESC, t.id DESC LIMIT v_lim)
  ), top AS (SELECT k.tid, k.tat FROM pick k ORDER BY k.tat DESC, k.tid DESC LIMIT v_lim)
  SELECT v.id, v.peer_user, v.peer_name, v.peer_title, v.peer_active, v.company_id, v.company_name, v.last, v.unread, v.last_at, v.read_only
    FROM top
    CROSS JOIN LATERAL hub.pmsg_view(top.tid, v_tid, v_uid) v
   ORDER BY v.last_at DESC, v.id DESC;
END $$;
--> statement-breakpoint

-- (2) Trong các id cờ `p_ids`: cuộc mà người gọi còn là MỘT ĐẦU và KHÔNG còn tin chưa đọc thật (cùng luật đếm với `pmsg_view.unread` / `pmsg_unread`: sau mốc đọc, không do u gửi,
-- chưa thu hồi). Dùng cộng vào tổng chưa đọc: cuộc đã có tin chưa đọc thật không bị đếm đôi, cuộc người gọi không còn là đầu không được đếm. MỘT câu, trần 999.
CREATE OR REPLACE FUNCTION hub.pmsg_flagged_idle(p_ids uuid[])
RETURNS SETOF uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_tid uuid;
  v_uid uuid;
BEGIN
  SELECT c.tid, c.uid INTO v_tid, v_uid FROM hub.pmsg_ctx() c;
  RETURN QUERY
  SELECT k.tid FROM (
    SELECT t.id AS tid, t.a_read_seq AS rd FROM hub.pmsg_threads t
     WHERE t.id = ANY (COALESCE(p_ids, '{}'::uuid[])) AND t.a_tenant = v_tid AND t.a_user = v_uid
    UNION ALL
    SELECT t.id, t.b_read_seq FROM hub.pmsg_threads t
     WHERE t.id = ANY (COALESCE(p_ids, '{}'::uuid[])) AND t.b_tenant = v_tid AND t.b_user = v_uid) k
   WHERE NOT EXISTS (SELECT 1 FROM hub.pmsg_messages x
                      WHERE x.thread_id = k.tid AND x.seq > k.rd AND x.sender_user <> v_uid AND x.deleted_at IS NULL)
   LIMIT 999;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION hub.pmsg_inbox_unread(uuid, timestamptz, uuid, integer, uuid[]) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION hub.pmsg_flagged_idle(uuid[]) FROM PUBLIC;
--> statement-breakpoint
-- GRANT tối thiểu: hub_rw và, khi role đã có, `contracts_rw` (DB dựng sạch: cấp lại ở pack-contracts 0126). Chạy lại vô hại.
GRANT EXECUTE ON FUNCTION hub.pmsg_inbox_unread(uuid, timestamptz, uuid, integer, uuid[]), hub.pmsg_flagged_idle(uuid[]) TO hub_rw;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'contracts_rw') THEN
    GRANT USAGE ON SCHEMA hub TO contracts_rw;
    GRANT EXECUTE ON FUNCTION hub.pmsg_inbox_unread(uuid, timestamptz, uuid, integer, uuid[]), hub.pmsg_flagged_idle(uuid[]) TO contracts_rw;
  END IF;
END $$;

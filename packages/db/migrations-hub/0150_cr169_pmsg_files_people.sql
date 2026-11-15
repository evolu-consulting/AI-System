-- CR-169 · lát 2b · spec §3 (P3, P4, P8, P10) · §5 (hub 0150) · tệp đính kèm, danh bạ người, danh sách công ty cho «Tin nhắn» 1–1 giữa hai công ty đã kết nối.
-- Khuôn: 0148 (cc_file_add/get/sweep: box_file_id 16 hex do FileBox, storage_key '<tenant>/<id>', sweep CHỈ scope system) + 0149 (pmsg_ctx, pmsg_eligible_raw).
-- Mọi hàm theo người dùng gọi `hub.pmsg_ctx()` (user từ `app.user_id`, không là tham số; thiếu/không hợp lệ ⇒ 42501, P1). Id cuộc từ ngoài LUÔN đối chiếu
-- «u là một trong hai đầu» ⇒ công ty thứ ba/người ngoài cuộc nhận CC404 MSG_NOT_FOUND (P3). Mã lỗi như 0149: CC404 · CC409 · CC422 MSG_FILE_INVALID · 22023.
-- Danh bạ: người của {A} ∪ công ty ĐANG kết nối với A, còn dùng được (cùng luật `pmsg_eligible_raw` — nguồn duy nhất, G1) ⇒ có quyền Sổ Hợp Tác, không external.
--     Trả tên, chức vụ, công ty (+ phòng ban chỉ cho người của A); KHÔNG email/điện thoại. Công ty ngoài tập kết nối bị bỏ im lặng (không lỗi, không lộ).
-- (A) Minor soát 2a: `pmsg_send` — kiểm gửi lặp (client_id) đặt TRƯỚC kiểm kết nối (sau khoá) ⇒ gửi lại sau khi ngắt trả tin cũ, không CC409;
--     UPDATE gắn tệp lọc thêm tenant_id/user_id/seq IS NULL. CREATE OR REPLACE (KHÔNG sửa 0149 đã gộp); thân còn lại giữ NGUYÊN VĂN 0149.
-- Chạy lại được: CREATE OR REPLACE; REVOKE lặp vô hại. GRANT ở 0151.

-- ── (A) pmsg_send (thay thế 0149) ───────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION hub.pmsg_send(p_id uuid, p_client_id uuid, p_body text, p_file_ids uuid[])
RETURNS TABLE (seq bigint, created boolean, message jsonb, notify jsonb)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_tid uuid;
  v_uid uuid;
  v_ids uuid[] := COALESCE(p_file_ids, '{}'::uuid[]);
  v_body text := COALESCE(p_body, '');
  v_pt uuid;
  v_pu uuid;
  v_files jsonb;
  v_nf integer;
  v_seq bigint;
  v_a boolean;
  th hub.pmsg_threads;
  m hub.pmsg_messages;
BEGIN
  SELECT c.tid, c.uid INTO v_tid, v_uid FROM hub.pmsg_ctx() c;
  IF p_id IS NULL OR p_client_id IS NULL THEN
    RAISE EXCEPTION 'pmsg_send: đầu vào không hợp lệ' USING ERRCODE = '22023';
  END IF;
  IF char_length(v_body) > 4000 THEN
    RAISE EXCEPTION 'MSG_TOO_LONG' USING ERRCODE = 'CC400';
  END IF;
  IF cardinality(v_ids) > 10 THEN
    RAISE EXCEPTION 'MSG_TOO_MANY_FILES' USING ERRCODE = 'CC400';
  END IF;
  IF v_body ~ '^[[:space:]]*$' AND cardinality(v_ids) = 0 THEN
    RAISE EXCEPTION 'MSG_EMPTY' USING ERRCODE = 'CC400';
  END IF;
  -- Đầu kia (không khoá), rồi khoá advisory cặp, rồi khoá hàng thread — cùng thứ tự với mọi hàm khác.
  SELECT CASE WHEN t.a_tenant = v_tid AND t.a_user = v_uid THEN t.b_tenant ELSE t.a_tenant END,
         CASE WHEN t.a_tenant = v_tid AND t.a_user = v_uid THEN t.b_user ELSE t.a_user END
    INTO v_pt, v_pu
    FROM hub.pmsg_threads t
   WHERE t.id = p_id AND ((t.a_tenant = v_tid AND t.a_user = v_uid) OR (t.b_tenant = v_tid AND t.b_user = v_uid));
  IF v_pt IS NULL THEN
    RAISE EXCEPTION 'MSG_NOT_FOUND' USING ERRCODE = 'CC404';
  END IF;
  PERFORM pg_advisory_xact_lock_shared(hashtextextended(least(v_tid::text, v_pt::text) || greatest(v_tid::text, v_pt::text), 161));
  SELECT * INTO th FROM hub.pmsg_threads t WHERE t.id = p_id FOR UPDATE;
  -- Gửi lặp: trả tin cũ, KỂ CẢ sau khi ngắt kết nối (client gửi lại khi mất mạng không bị báo lỗi giả). Sau khoá ⇒ hai tx cùng client_id tuần tự.
  SELECT * INTO m FROM hub.pmsg_messages x WHERE x.thread_id = p_id AND x.sender_user = v_uid AND x.client_id = p_client_id;
  IF FOUND THEN
    seq := m.seq; created := false; message := hub.pmsg_msg_json(m); notify := '[]'::jsonb;
    RETURN NEXT;
    RETURN;
  END IF;
  IF NOT hub.cc_connected_raw(v_tid, v_pt) THEN
    RAISE EXCEPTION 'MSG_NOT_CONNECTED' USING ERRCODE = 'CC409';
  END IF;
  IF NOT hub.pmsg_eligible_raw(v_pt, v_pu) THEN
    RAISE EXCEPTION 'MSG_PEER_INACTIVE' USING ERRCODE = 'CC409';
  END IF;
  v_files := '[]'::jsonb;
  IF cardinality(v_ids) > 0 THEN
    IF cardinality(v_ids) <> (SELECT count(DISTINCT u.fid) FROM unnest(v_ids) AS u(fid)) THEN
      RAISE EXCEPTION 'MSG_FILE_INVALID' USING ERRCODE = 'CC422';
    END IF;
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name, 'mime', f.mime, 'size', f.size) ORDER BY u.ord), '[]'::jsonb),
           count(*)::integer
      INTO v_files, v_nf
      FROM unnest(v_ids) WITH ORDINALITY AS u(fid, ord)
      JOIN hub.pmsg_files f ON f.id = u.fid AND f.thread_id = p_id AND f.tenant_id = v_tid AND f.user_id = v_uid
                           AND f.seq IS NULL AND f.deleted_at IS NULL;
    IF v_nf <> cardinality(v_ids) THEN
      RAISE EXCEPTION 'MSG_FILE_INVALID' USING ERRCODE = 'CC422';
    END IF;
  END IF;
  v_seq := th.last_seq + 1;
  v_a := th.a_tenant = v_tid AND th.a_user = v_uid;
  INSERT INTO hub.pmsg_messages (thread_id, seq, sender_user, body, files, client_id)
  VALUES (p_id, v_seq, v_uid, v_body, v_files, p_client_id)
  RETURNING * INTO m;
  UPDATE hub.pmsg_threads t
     SET last_seq = v_seq, last_at = now(),
         a_read_seq = CASE WHEN v_a THEN v_seq ELSE t.a_read_seq END,
         b_read_seq = CASE WHEN v_a THEN t.b_read_seq ELSE v_seq END
   WHERE t.id = p_id;
  UPDATE hub.pmsg_files f SET seq = v_seq
   WHERE f.id = ANY (v_ids) AND f.thread_id = p_id AND f.tenant_id = v_tid AND f.user_id = v_uid AND f.seq IS NULL;
  seq := v_seq; created := true; message := hub.pmsg_msg_json(m);
  notify := jsonb_build_array(jsonb_build_object('tenant_id', v_tid, 'user_id', v_uid), jsonb_build_object('tenant_id', v_pt, 'user_id', v_pu));
  RETURN NEXT;
END $$;
--> statement-breakpoint

-- ── (B) Tệp ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
-- P4 · ghi tệp tải lên cuộc p_id (route đã lưu nội dung lên FileBox ⇒ p_box_id = file_id FileBox, 16 hex; p_file_id uuid + p_storage_key do route sinh,
-- key = '<tenant bên tải>/<p_file_id>'). Chưa gắn tin cho tới khi pmsg_send nhận id. Thứ tự lỗi: không phải đầu của cuộc ⇒ CC404 · hết kết nối ⇒ CC409
-- MSG_NOT_CONNECTED · người kia không hợp lệ ⇒ CC409 MSG_PEER_INACTIVE · tên/mime/kích thước/khoá/box id sai hoặc ≥ 50 tệp chưa gắn của người ⇒ CC422 MSG_FILE_INVALID.
-- Khoá: advisory SHARED theo cặp (như pmsg_send) rồi advisory theo NGƯỜI (giữ trần 50 chính xác khi tải song song; không hàm nào khác lấy khoá này ⇒ không vòng khoá).
CREATE OR REPLACE FUNCTION hub.pmsg_file_add(
  p_id uuid, p_file_id uuid, p_box_id text, p_name text, p_mime text, p_size bigint, p_storage_key text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_tid uuid;
  v_uid uuid;
  v_pt uuid;
  v_pu uuid;
BEGIN
  SELECT c.tid, c.uid INTO v_tid, v_uid FROM hub.pmsg_ctx() c;
  IF p_id IS NULL OR p_file_id IS NULL THEN
    RAISE EXCEPTION 'pmsg_file_add: đầu vào không hợp lệ' USING ERRCODE = '22023';
  END IF;
  SELECT CASE WHEN t.a_tenant = v_tid AND t.a_user = v_uid THEN t.b_tenant ELSE t.a_tenant END,
         CASE WHEN t.a_tenant = v_tid AND t.a_user = v_uid THEN t.b_user ELSE t.a_user END
    INTO v_pt, v_pu
    FROM hub.pmsg_threads t
   WHERE t.id = p_id AND ((t.a_tenant = v_tid AND t.a_user = v_uid) OR (t.b_tenant = v_tid AND t.b_user = v_uid));
  IF v_pt IS NULL THEN
    RAISE EXCEPTION 'MSG_NOT_FOUND' USING ERRCODE = 'CC404';
  END IF;
  PERFORM pg_advisory_xact_lock_shared(hashtextextended(least(v_tid::text, v_pt::text) || greatest(v_tid::text, v_pt::text), 161));
  IF NOT hub.cc_connected_raw(v_tid, v_pt) THEN
    RAISE EXCEPTION 'MSG_NOT_CONNECTED' USING ERRCODE = 'CC409';
  END IF;
  IF NOT hub.pmsg_eligible_raw(v_pt, v_pu) THEN
    RAISE EXCEPTION 'MSG_PEER_INACTIVE' USING ERRCODE = 'CC409';
  END IF;
  -- Kiểm tệp trong hàm (lỗi nghiệp vụ CC422, không phải 23514): tên 1..255, mime 1..100, 1 ≤ size ≤ 20 MB, khoá = '<tenant>/<id>', id FileBox dạng an toàn.
  IF p_name IS NULL OR char_length(btrim(p_name)) NOT BETWEEN 1 AND 255 OR p_mime IS NULL OR char_length(p_mime) NOT BETWEEN 1 AND 100
     OR p_size IS NULL OR p_size NOT BETWEEN 1 AND 20971520 OR p_storage_key IS DISTINCT FROM v_tid::text || '/' || p_file_id::text
     OR p_box_id IS NULL OR p_box_id !~ '^[A-Za-z0-9_-]{1,64}$' THEN
    RAISE EXCEPTION 'MSG_FILE_INVALID' USING ERRCODE = 'CC422';
  END IF;
  -- Trần tệp chưa gắn tin mỗi người (chống nhồi dung lượng): 50 — đếm trên index một phần (user_id) WHERE seq IS NULL AND deleted_at IS NULL.
  PERFORM pg_advisory_xact_lock(hashtextextended('pmsg_file_add:' || v_uid::text, 169));
  IF (SELECT count(*) FROM hub.pmsg_files f WHERE f.user_id = v_uid AND f.seq IS NULL AND f.deleted_at IS NULL) >= 50 THEN
    RAISE EXCEPTION 'MSG_FILE_INVALID' USING ERRCODE = 'CC422';
  END IF;
  INSERT INTO hub.pmsg_files (id, thread_id, tenant_id, user_id, name, mime, size, storage_key, box_file_id)
  VALUES (p_file_id, p_id, v_tid, v_uid, btrim(p_name), p_mime, p_size, p_storage_key, p_box_id);
  RETURN jsonb_build_object('id', p_file_id, 'name', btrim(p_name), 'mime', p_mime, 'size', p_size);
END $$;
--> statement-breakpoint
-- P3 · nơi lưu nội dung của tệp thuộc cuộc p_id: khoá (suy ra org FileBox bên tải) + id FileBox. Chỉ hai đầu của cuộc (kể cả đã ngắt: tệp của tin cũ vẫn tải được);
-- tệp chưa gắn tin CHỈ người tải thấy; tệp của tin đã thu hồi/đã dọn ⇒ không thấy. Không thấy ⇒ 0 dòng (route 404, không lộ). Công ty thứ ba ⇒ 0 dòng.
CREATE OR REPLACE FUNCTION hub.pmsg_file_get(p_id uuid, p_file_id uuid)
RETURNS TABLE (storage_key text, box_file_id text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_tid uuid;
  v_uid uuid;
BEGIN
  SELECT c.tid, c.uid INTO v_tid, v_uid FROM hub.pmsg_ctx() c;
  RETURN QUERY
  SELECT f.storage_key, f.box_file_id
    FROM hub.pmsg_files f JOIN hub.pmsg_threads t ON t.id = f.thread_id
   WHERE f.id = p_file_id AND f.thread_id = p_id AND f.deleted_at IS NULL
     AND ((t.a_tenant = v_tid AND t.a_user = v_uid) OR (t.b_tenant = v_tid AND t.b_user = v_uid))
     AND (f.seq IS NOT NULL OR (f.tenant_id = v_tid AND f.user_id = v_uid));
END $$;
--> statement-breakpoint
-- Dọn tệp chưa gắn tin quá p_older (việc nền, CHỈ scope system): soft delete + trả khoá + id FileBox để xoá nội dung. Không đụng tệp đã gắn tin. Một câu UPDATE … RETURNING.
CREATE OR REPLACE FUNCTION hub.pmsg_files_sweep(p_older interval)
RETURNS TABLE (file_id uuid, storage_key text, box_file_id text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
#variable_conflict use_column
BEGIN
  IF current_setting('app.scope', true) IS DISTINCT FROM 'system' THEN
    RAISE EXCEPTION 'pmsg_files_sweep: chỉ việc nền (scope system)' USING ERRCODE = '42501';
  END IF;
  IF p_older IS NULL OR p_older < interval '1 hour' THEN
    RAISE EXCEPTION 'pmsg_files_sweep: khoảng thời gian không hợp lệ' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  WITH u AS (
    UPDATE hub.pmsg_files f SET deleted_at = now()
     WHERE f.seq IS NULL AND f.deleted_at IS NULL AND f.created_at < now() - p_older
    RETURNING f.id AS fid, f.storage_key AS skey, f.box_file_id AS bid)
  SELECT u.fid, u.skey, u.bid FROM u;
END $$;
--> statement-breakpoint

-- ── (C) Danh bạ người + công ty đã kết nối ──────────────────────────────────────────────────────────────────────────────────────
-- Nội bộ (KHÔNG GRANT): các công ty đang kết nối với p_tenant (hai chiều accepted, không bị chặn — cùng nghĩa `cc_connected_raw`), MỘT câu cho cả tập.
CREATE OR REPLACE FUNCTION hub.pmsg_connected(p_tenant uuid)
RETURNS TABLE (tid uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT o.to_tenant
    FROM hub.partner_links o
    JOIN hub.partner_links i ON i.from_tenant = o.to_tenant AND i.to_tenant = o.from_tenant
   WHERE o.from_tenant = p_tenant AND o.accepted_at IS NOT NULL AND o.blocked_at IS NULL
     AND i.accepted_at IS NOT NULL AND i.blocked_at IS NULL
$$;
--> statement-breakpoint
-- P8 · danh bạ: người của {A} ∪ công ty đang kết nối, ∩ p_tenants (null = tất cả; công ty ngoài tập ⇒ bỏ im lặng; mảng rỗng ⇒ rỗng). Loại chính u; chỉ người
-- `pmsg_eligible_raw` (có quyền Sổ Hợp Tác, không external, đang dùng). `p_q` khớp tên HOẶC chức vụ, không phân biệt hoa/dấu (`hub.fold`).
-- Keyset (sort_key, user_id) với sort_key = hub.fold(name) — con trỏ là hai cột trả về của dòng cuối. limit kẹp 1..101. Phòng ban chỉ cho người của A.
-- MỘT câu: lọc + sắp + LIMIT trước, phòng ban join sau trên ≤ limit dòng.
CREATE OR REPLACE FUNCTION hub.pmsg_people(p_tenants uuid[], p_q text, p_cur_name text, p_cur_id uuid, p_limit integer)
RETURNS TABLE (user_id uuid, name text, job_title text, tenant_id uuid, company_name text, department_id uuid, department_name text, sort_key text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_tid uuid;
  v_uid uuid;
  v_lim integer := LEAST(GREATEST(COALESCE(p_limit, 30), 1), 101);
  v_q text := hub.fold(replace(replace(replace(btrim(COALESCE(p_q, '')), '\', '\\'), '%', '\%'), '_', '\_'));
BEGIN
  SELECT c.tid, c.uid INTO v_tid, v_uid FROM hub.pmsg_ctx() c;
  RETURN QUERY
  WITH ts AS (
    SELECT v_tid AS tid
    UNION
    SELECT k.tid FROM hub.pmsg_connected(v_tid) k),
  pg AS (
    SELECT u.id AS uid, COALESCE(u.display_name, '') AS nm, hub.fold(COALESCE(u.display_name, '')) AS k, u.tenant_id AS tid, pp.job_title AS jt
      FROM ts
      JOIN admin.users u ON u.tenant_id = ts.tid
      LEFT JOIN hub.people_profiles pp ON pp.tenant_id = u.tenant_id AND pp.user_id = u.id
     WHERE (p_tenants IS NULL OR ts.tid = ANY (p_tenants))
       AND u.id <> v_uid AND u.active AND NOT u.locked_by_tenant AND u.kind <> 'external'
       AND (v_q = '' OR hub.fold(COALESCE(u.display_name, '')) LIKE '%' || v_q || '%' OR hub.fold(COALESCE(pp.job_title, '')) LIKE '%' || v_q || '%')
       AND (p_cur_name IS NULL OR p_cur_id IS NULL OR (hub.fold(COALESCE(u.display_name, '')), u.id) > (p_cur_name, p_cur_id))
       AND hub.pmsg_eligible_raw(u.tenant_id, u.id)
     ORDER BY hub.fold(COALESCE(u.display_name, '')), u.id
     LIMIT v_lim)
  SELECT pg.uid, pg.nm, pg.jt, pg.tid, COALESCE(tn.legal_name, tn.name), d.gid, d.gname, pg.k
    FROM pg
    JOIN admin.tenants tn ON tn.id = pg.tid
    LEFT JOIN LATERAL (
      SELECT g.id AS gid, COALESCE(g.name ->> 'vi', g.key) AS gname
        FROM admin.group_members gm
        JOIN admin.departments dp ON dp.group_id = gm.group_id AND dp.tenant_id = gm.tenant_id
        JOIN admin.groups g ON g.id = gm.group_id AND g.tenant_id = gm.tenant_id
       WHERE pg.tid = v_tid AND gm.user_id = pg.uid AND gm.tenant_id = pg.tid
       ORDER BY g.key LIMIT 1) d ON true
   ORDER BY pg.k, pg.uid;
END $$;
--> statement-breakpoint
-- P10 · công ty đang kết nối với A (chip lọc), theo tên, keyset (sort_key, company_id), limit kẹp 1..101. Đã ngắt ⇒ không có.
CREATE OR REPLACE FUNCTION hub.pmsg_companies(p_cur_name text, p_cur_id uuid, p_limit integer)
RETURNS TABLE (company_id uuid, name text, sort_key text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_tid uuid;
  v_uid uuid;
  v_lim integer := LEAST(GREATEST(COALESCE(p_limit, 30), 1), 101);
BEGIN
  SELECT c.tid, c.uid INTO v_tid, v_uid FROM hub.pmsg_ctx() c;
  RETURN QUERY
  SELECT t.id, COALESCE(t.legal_name, t.name), hub.fold(COALESCE(t.legal_name, t.name))
    FROM hub.pmsg_connected(v_tid) k
    JOIN admin.tenants t ON t.id = k.tid
   WHERE p_cur_name IS NULL OR p_cur_id IS NULL OR (hub.fold(COALESCE(t.legal_name, t.name)), t.id) > (p_cur_name, p_cur_id)
   ORDER BY 3, 1
   LIMIT v_lim;
END $$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION hub.pmsg_file_add(uuid, uuid, text, text, text, bigint, text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION hub.pmsg_file_get(uuid, uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION hub.pmsg_files_sweep(interval) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION hub.pmsg_connected(uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION hub.pmsg_people(uuid[], text, text, uuid, integer) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION hub.pmsg_companies(text, uuid, integer) FROM PUBLIC;

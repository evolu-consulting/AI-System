-- CR-190 · lát `cr190-msg-directory-api` · danh bạ nhóm theo CÔNG TY đối tác cho trang Tin nhắn. CHỈ THÊM hàm mới (prod có khách thật), khuôn 0166: DEFINER, search_path cố định,
-- người dùng từ `hub.pmsg_ctx()` (KHÔNG là tham số). KHÔNG mở rộng ai được nhắn ai: «người nhắn được» = đúng `pmsg_eligible_v` của các công ty ĐANG KẾT NỐI (cùng nguồn `pmsg_people`/`pmsg_open`),
-- cộng đầu kia của cuộc ĐÃ CÓ (lịch sử + chưa đọc vẫn thấy, `read_only` tính như `pmsg_view`). Mảng id ghim/cờ do pack-contracts truyền vào chỉ có tác dụng trên cuộc người gọi là một đầu.
-- Thứ tự trong nhóm (BR-190-6): ghim → tin mới nhất → chưa từng nhắn theo tên A→Z; khoá = (k1, k2, k3, user_id), keyset tăng dần.

-- (1) Nội bộ (KHÔNG GRANT): MỘT dòng cho mỗi (công ty đối tác × người) kèm cuộc nếu có; số chưa đọc thật kẹp 100 mỗi cuộc, chỉ tính trên cuộc đã có (cùng luật `pmsg_view`).
-- `p_company` (không null) đẩy xuống từ đầu ⇒ «Xem thêm» một nhóm không đụng nhóm khác. Lọc `p_q` (tên, chức vụ, tên công ty; `hub.fold`).
CREATE OR REPLACE FUNCTION hub.pmsg_dir_base(p_company uuid, p_q text, p_pinned uuid[])
RETURNS TABLE (
  tid uuid, cname text, ckey text, uid uuid, nm text, k3 text, jt text, thid uuid, last_at timestamptz, last_seq bigint, unread integer, k1 integer, k2 numeric, ce boolean
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
  v_q text := hub.fold(replace(replace(replace(btrim(COALESCE(p_q, '')), '\', '\\'), '%', '\%'), '_', '\_'));
  v_pin uuid[] := COALESCE(p_pinned, '{}'::uuid[]);
BEGIN
  SELECT c.tid, c.uid INTO v_tid, v_uid FROM hub.pmsg_ctx() c;
  RETURN QUERY
  WITH th AS (
    SELECT k.* FROM (
      SELECT t.id AS thid, t.b_tenant AS pt, t.b_user AS pu, t.last_at, t.last_seq, t.a_read_seq AS rd FROM hub.pmsg_threads t
       WHERE t.a_tenant = v_tid AND t.a_user = v_uid
      UNION ALL
      SELECT t.id, t.a_tenant, t.a_user, t.last_at, t.last_seq, t.b_read_seq FROM hub.pmsg_threads t
       WHERE t.b_tenant = v_tid AND t.b_user = v_uid) k
     WHERE p_company IS NULL OR k.pt = p_company),
  tu AS (
    SELECT th.thid, un.n FROM th
      CROSS JOIN LATERAL (
        SELECT count(*)::integer AS n FROM (
          SELECT 1 FROM hub.pmsg_messages x
           WHERE th.last_seq > th.rd AND x.thread_id = th.thid AND x.seq > th.rd AND x.sender_user <> v_uid AND x.deleted_at IS NULL
           LIMIT 100) q) un),
  el AS (
    SELECT e.tenant_id AS pt, e.user_id AS pu
      FROM hub.pmsg_connected(v_tid) ts
      JOIN hub.pmsg_eligible_v e ON e.tenant_id = ts.tid
     WHERE e.user_id <> v_uid AND (p_company IS NULL OR ts.tid = p_company)),
  ppl AS (
    SELECT z.pt, z.pu, bool_or(z.ce) AS ce
      FROM (SELECT el.pt, el.pu, true AS ce FROM el UNION ALL SELECT th.pt, th.pu, false FROM th) z
     GROUP BY z.pt, z.pu),
  j AS (
    SELECT p.pt, p.pu, th.thid, th.last_at AS lat, COALESCE(th.last_seq, 0) AS lseq, p.ce
      FROM ppl p LEFT JOIN th ON th.pt = p.pt AND th.pu = p.pu),
  f AS (
    SELECT j.pt, COALESCE(tn.legal_name, tn.name) AS cn, hub.fold(COALESCE(tn.legal_name, tn.name)) AS ck, j.pu,
           COALESCE(u.display_name, '') AS nm, hub.fold(COALESCE(u.display_name, '')) AS k3, pp.job_title AS jt,
           j.thid, j.lat, j.lseq, j.ce
      FROM j
      JOIN admin.tenants tn ON tn.id = j.pt
      LEFT JOIN admin.users u ON u.id = j.pu
      LEFT JOIN hub.people_profiles pp ON pp.tenant_id = j.pt AND pp.user_id = j.pu
     WHERE v_q = ''
        OR hub.fold(COALESCE(u.display_name, '')) LIKE '%' || v_q || '%'
        OR hub.fold(COALESCE(pp.job_title, '')) LIKE '%' || v_q || '%'
        OR hub.fold(COALESCE(tn.legal_name, tn.name)) LIKE '%' || v_q || '%')
  SELECT f.pt, f.cn, f.ck, f.pu, f.nm, f.k3, f.jt, f.thid, f.lat, f.lseq, COALESCE(tu.n, 0),
         CASE WHEN f.thid = ANY (v_pin) THEN 0 WHEN f.lseq > 0 THEN 1 ELSE 2 END,
         CASE WHEN f.lseq > 0 THEN -(extract(epoch FROM f.lat)::numeric) ELSE 0::numeric END, f.ce
    FROM f
    LEFT JOIN tu ON tu.thid = f.thid;
END $$;
--> statement-breakpoint

-- (2) Đầu mỗi nhóm công ty (`p_company` null = mọi công ty): tổng người (người nhắn được ∪ đầu kia của cuộc đã có), tổng chưa đọc = Σ max(thật, cờ ? 1 : 0) mỗi cuộc (cùng luật `unread` của danh sách), kẹp 999.
-- Công ty ĐANG KẾT NỐI luôn có nhóm (kể cả 0 người); công ty đã ngắt chỉ có khi còn cuộc. Có `p_q` ⇒ chỉ nhóm còn dòng khớp, số tính trên dòng khớp (đi qua `pmsg_dir_base`); không `p_q` ⇒ đường nhẹ, không join tên/hồ sơ.
CREATE OR REPLACE FUNCTION hub.pmsg_dir_heads(p_company uuid, p_q text, p_flagged uuid[])
RETURNS TABLE (company_id uuid, name text, total integer, unread integer)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_tid uuid;
  v_uid uuid;
  v_flag uuid[] := COALESCE(p_flagged, '{}'::uuid[]);
  v_none boolean := btrim(COALESCE(p_q, '')) = '';
BEGIN
  SELECT c.tid, c.uid INTO v_tid, v_uid FROM hub.pmsg_ctx() c;
  IF NOT v_none THEN
    RETURN QUERY
    WITH b AS (SELECT * FROM hub.pmsg_dir_base(p_company, p_q, NULL))
    SELECT b.tid, b.cname, count(*)::integer,
           LEAST(sum(GREATEST(b.unread, CASE WHEN b.thid = ANY (v_flag) THEN 1 ELSE 0 END)), 999)::integer
      FROM b GROUP BY b.tid, b.cname, b.ckey
     ORDER BY b.ckey, b.tid;
    RETURN;
  END IF;
  RETURN QUERY
  WITH th AS (
    SELECT k.* FROM (
      SELECT t.id AS thid, t.b_tenant AS pt, t.b_user AS pu, t.last_seq, t.a_read_seq AS rd FROM hub.pmsg_threads t
       WHERE t.a_tenant = v_tid AND t.a_user = v_uid
      UNION ALL
      SELECT t.id, t.a_tenant, t.a_user, t.last_seq, t.b_read_seq FROM hub.pmsg_threads t
       WHERE t.b_tenant = v_tid AND t.b_user = v_uid) k
     WHERE p_company IS NULL OR k.pt = p_company),
  tu AS (
    SELECT th.thid, th.pt, GREATEST(un.n, CASE WHEN th.thid = ANY (v_flag) THEN 1 ELSE 0 END) AS n FROM th
      CROSS JOIN LATERAL (
        SELECT count(*)::integer AS n FROM (
          SELECT 1 FROM hub.pmsg_messages x
           WHERE th.last_seq > th.rd AND x.thread_id = th.thid AND x.seq > th.rd AND x.sender_user <> v_uid AND x.deleted_at IS NULL
           LIMIT 100) q) un),
  conn AS (SELECT k.tid FROM hub.pmsg_connected(v_tid) k WHERE p_company IS NULL OR k.tid = p_company),
  ppl AS (
    SELECT e.tenant_id AS pt, e.user_id AS pu FROM conn ts JOIN hub.pmsg_eligible_v e ON e.tenant_id = ts.tid WHERE e.user_id <> v_uid
    UNION SELECT th.pt, th.pu FROM th),
  tot AS (SELECT ppl.pt, count(*)::integer AS n FROM ppl GROUP BY ppl.pt),
  un AS (SELECT tu.pt, LEAST(sum(tu.n), 999)::integer AS n FROM tu GROUP BY tu.pt)
  SELECT x.tid, COALESCE(t.legal_name, t.name), COALESCE(tot.n, 0), COALESCE(un.n, 0)
    FROM (SELECT c.tid FROM conn c UNION SELECT th.pt FROM th) x
    JOIN admin.tenants t ON t.id = x.tid
    LEFT JOIN tot ON tot.pt = x.tid
    LEFT JOIN un ON un.pt = x.tid
   ORDER BY hub.fold(COALESCE(t.legal_name, t.name)), x.tid;
END $$;
--> statement-breakpoint

-- (3) Dòng của nhóm: `p_company` NULL ⇒ `p_limit` dòng ĐẦU của MỖI công ty (một câu cho mọi nhóm); có giá trị ⇒ trang kế của riêng công ty đó sau con trỏ (p_c1, p_c2, p_c3, p_cid) = khoá dòng cuối.
-- Cuộc đã có: tin cuối (tra theo PK) CHỈ cho các dòng của trang; `read_only` = NOT (kết nối ∧ đủ điều kiện) và `peer_active` = đủ điều kiện — cùng nghĩa `pmsg_view`. Người chưa từng nhắn thì đủ điều kiện (active, không read_only).
-- `unread` đã gộp cờ; trả kèm khoá (k1, k2, k3) để route dựng con trỏ.
CREATE OR REPLACE FUNCTION hub.pmsg_dir_rows(
  p_company uuid, p_q text, p_pinned uuid[], p_flagged uuid[], p_c1 integer, p_c2 numeric, p_c3 text, p_cid uuid, p_limit integer)
RETURNS TABLE (
  company_id uuid, company_name text, user_id uuid, name text, job_title text, thread_id uuid, last jsonb, last_at timestamptz,
  unread integer, peer_active boolean, read_only boolean, k1 integer, k2 text, k3 text
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
  v_lim integer := LEAST(GREATEST(COALESCE(p_limit, 15), 1), 51);
  v_flag uuid[] := COALESCE(p_flagged, '{}'::uuid[]);
BEGIN
  SELECT c.tid, c.uid INTO v_tid, v_uid FROM hub.pmsg_ctx() c;
  RETURN QUERY
  WITH b AS (
    SELECT * FROM hub.pmsg_dir_base(p_company, p_q, p_pinned) d
     WHERE p_c1 IS NULL OR p_c2 IS NULL OR p_c3 IS NULL OR p_cid IS NULL OR (d.k1, d.k2, d.k3, d.uid) > (p_c1, p_c2, p_c3, p_cid)),
  r AS (SELECT b.*, row_number() OVER (PARTITION BY b.tid ORDER BY b.k1, b.k2, b.k3, b.uid) AS rn FROM b)
  SELECT r.tid, r.cname, r.uid, r.nm, r.jt, r.thid,
         CASE WHEN lm.seq IS NULL THEN NULL ELSE jsonb_build_object('seq', lm.seq, 'sender_id', lm.sender_user,
           'sender_name', COALESCE(su.display_name, ''), 'preview', lm.preview, 'has_files', lm.has_files, 'deleted', lm.deleted, 'at', lm.at) END,
         r.last_at, GREATEST(r.unread, CASE WHEN r.thid = ANY (v_flag) THEN 1 ELSE 0 END),
         r.ce OR (r.thid IS NOT NULL AND hub.pmsg_eligible_raw(r.tid, r.uid)), NOT r.ce, r.k1, r.k2::text, r.k3
    FROM r
    LEFT JOIN LATERAL (
      SELECT x.seq, x.sender_user, CASE WHEN x.deleted_at IS NULL THEN left(x.body, 240) ELSE '' END AS preview,
             x.deleted_at IS NULL AND jsonb_array_length(x.files) > 0 AS has_files, x.deleted_at IS NOT NULL AS deleted,
             to_char(x.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at
        FROM hub.pmsg_messages x WHERE x.thread_id = r.thid ORDER BY x.seq DESC LIMIT 1) lm ON r.thid IS NOT NULL
    LEFT JOIN admin.users su ON su.id = lm.sender_user
   WHERE r.rn <= v_lim
   ORDER BY r.ckey, r.tid, r.rn;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION hub.pmsg_dir_base(uuid, text, uuid[]) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION hub.pmsg_dir_heads(uuid, text, uuid[]) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION hub.pmsg_dir_rows(uuid, text, uuid[], uuid[], integer, numeric, text, uuid, integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION hub.pmsg_dir_heads(uuid, text, uuid[]), hub.pmsg_dir_rows(uuid, text, uuid[], uuid[], integer, numeric, text, uuid, integer) TO hub_rw;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'contracts_rw') THEN
    GRANT USAGE ON SCHEMA hub TO contracts_rw;
    GRANT EXECUTE ON FUNCTION hub.pmsg_dir_heads(uuid, text, uuid[]), hub.pmsg_dir_rows(uuid, text, uuid[], uuid[], integer, numeric, text, uuid, integer) TO contracts_rw;
  END IF;
END $$;

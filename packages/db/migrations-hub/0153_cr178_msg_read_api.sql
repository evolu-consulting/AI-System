-- CR-178 · API đọc «Tin nhắn» (M3 tìm tin · M4 ảnh & tệp · M5 lọc chưa đọc) cho cuộc `partner` (`hub.pmsg_*`). CHỈ THÊM hàm mới (+ chỉ mục tìm): không sửa/xoá dữ liệu,
-- không đổi cột/hàm cũ (prod đã có khách thật). Khuôn 0149/0150: DEFINER, search_path cố định, người dùng lấy từ `hub.pmsg_ctx()` (KHÔNG là tham số), id cuộc từ ngoài
-- luôn đối chiếu «là một trong hai đầu» ⇒ người ngoài cuộc/công ty thứ ba nhận CC404 hoặc 0 dòng, không lộ (P3). Đọc được cả khi đã ngắt kết nối (P3).
-- Chạy lại được: CREATE OR REPLACE / IF NOT EXISTS. GRANT ở 0154 (+ pack-contracts 0120 cho `contracts_rw`).

-- ── M5 · danh sách cuộc CHỈ có tin chưa đọc ─────────────────────────────────────────────────────────────────────────────────────
-- Như `pmsg_inbox` (0149) + điều kiện «còn tin chưa đọc» áp TRƯỚC LIMIT của từng nhánh (trang luôn đầy, keyset đúng): last_seq > mốc đọc VÀ có ít nhất một tin
-- sau mốc, không do u gửi, chưa thu hồi (cùng luật đếm với `pmsg_view.unread` / `pmsg_unread`). Thân còn lại giữ NGUYÊN VĂN `pmsg_inbox`.
CREATE OR REPLACE FUNCTION hub.pmsg_inbox_unread(p_company uuid, p_cur_t timestamptz, p_cur_id uuid, p_limit integer)
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
BEGIN
  SELECT c.tid, c.uid INTO v_tid, v_uid FROM hub.pmsg_ctx() c;
  RETURN QUERY
  WITH pick AS (
    (SELECT t.id AS tid, t.last_at AS tat FROM hub.pmsg_threads t
      WHERE t.a_tenant = v_tid AND t.a_user = v_uid AND (p_company IS NULL OR t.b_tenant = p_company)
        AND t.last_seq > t.a_read_seq
        AND EXISTS (SELECT 1 FROM hub.pmsg_messages x WHERE x.thread_id = t.id AND x.seq > t.a_read_seq AND x.sender_user <> v_uid AND x.deleted_at IS NULL)
        AND (p_cur_t IS NULL OR p_cur_id IS NULL OR (t.last_at, t.id) < (p_cur_t, p_cur_id))
      ORDER BY t.last_at DESC, t.id DESC LIMIT v_lim)
    UNION ALL
    (SELECT t.id, t.last_at FROM hub.pmsg_threads t
      WHERE t.b_tenant = v_tid AND t.b_user = v_uid AND (p_company IS NULL OR t.a_tenant = p_company)
        AND t.last_seq > t.b_read_seq
        AND EXISTS (SELECT 1 FROM hub.pmsg_messages x WHERE x.thread_id = t.id AND x.seq > t.b_read_seq AND x.sender_user <> v_uid AND x.deleted_at IS NULL)
        AND (p_cur_t IS NULL OR p_cur_id IS NULL OR (t.last_at, t.id) < (p_cur_t, p_cur_id))
      ORDER BY t.last_at DESC, t.id DESC LIMIT v_lim)
  ), top AS (SELECT k.tid, k.tat FROM pick k ORDER BY k.tat DESC, k.tid DESC LIMIT v_lim)
  SELECT v.id, v.peer_user, v.peer_name, v.peer_title, v.peer_active, v.company_id, v.company_name, v.last, v.unread, v.last_at, v.read_only
    FROM top
    CROSS JOIN LATERAL hub.pmsg_view(top.tid, v_tid, v_uid) v
   ORDER BY v.last_at DESC, v.id DESC;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION hub.pmsg_inbox_unread(uuid, timestamptz, uuid, integer) FROM PUBLIC;
--> statement-breakpoint

-- ── M4 · «Ảnh & tệp» của một cuộc ───────────────────────────────────────────────────────────────────────────────────────────────
-- Tệp ĐÃ GỬI (gắn tin, tin chưa thu hồi, tệp chưa xoá) của cuộc p_id, mới nhất trước, keyset (seq, id) DESC. p_kind: NULL = cả hai | 'image' (mime image/*) | 'file' (còn lại).
-- u phải là một trong hai đầu, không thì CC404 (không lộ, P3); KHÔNG kiểm còn kết nối ⇒ đọc được cả sau ngắt (P3). Tệp chưa gắn tin (của người đang soạn) không ra.
-- p_limit kẹp 1..31 (route xin limit+1). Tên người gửi tra sẵn bằng join (không vòng lặp).
CREATE OR REPLACE FUNCTION hub.pmsg_files_list(p_id uuid, p_kind text, p_cur_seq bigint, p_cur_id uuid, p_limit integer)
RETURNS TABLE (id uuid, name text, mime text, size bigint, seq bigint, sender_user uuid, sender_name text, at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_tid uuid;
  v_uid uuid;
  v_lim integer := LEAST(GREATEST(COALESCE(p_limit, 30), 1), 31);
BEGIN
  SELECT c.tid, c.uid INTO v_tid, v_uid FROM hub.pmsg_ctx() c;
  IF p_id IS NULL OR (p_kind IS NOT NULL AND p_kind NOT IN ('image', 'file')) THEN
    RAISE EXCEPTION 'pmsg_files_list: đầu vào không hợp lệ' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM hub.pmsg_threads t
                  WHERE t.id = p_id AND ((t.a_tenant = v_tid AND t.a_user = v_uid) OR (t.b_tenant = v_tid AND t.b_user = v_uid))) THEN
    RAISE EXCEPTION 'MSG_NOT_FOUND' USING ERRCODE = 'CC404';
  END IF;
  RETURN QUERY
  SELECT f.id, f.name, f.mime, f.size, f.seq, m.sender_user, COALESCE(su.display_name, ''), m.created_at
    FROM hub.pmsg_files f
    JOIN hub.pmsg_messages m ON m.thread_id = f.thread_id AND m.seq = f.seq AND m.deleted_at IS NULL
    LEFT JOIN admin.users su ON su.id = m.sender_user
   WHERE f.thread_id = p_id AND f.seq IS NOT NULL AND f.deleted_at IS NULL
     AND (p_kind IS NULL OR (p_kind = 'image') = (f.mime LIKE 'image/%'))
     AND (p_cur_seq IS NULL OR p_cur_id IS NULL OR (f.seq, f.id) < (p_cur_seq, p_cur_id))
   ORDER BY f.seq DESC, f.id DESC
   LIMIT v_lim;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION hub.pmsg_files_list(uuid, text, bigint, uuid, integer) FROM PUBLIC;
--> statement-breakpoint

-- ── M3 · tìm tin ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
-- Tin khớp `p_pat` (đã thoát \ % _ ở route; hàm tự hub.fold + bọc %…%: không phân biệt hoa/dấu, khớp chứa) trong các cuộc mà u là MỘT ĐẦU (P3, kể cả đã ngắt kết nối), bỏ tin đã
-- thu hồi. p_conv (tuỳ chọn) ⇒ chỉ cuộc đó — không là đầu của cuộc đó ⇒ 0 dòng (không lộ có tồn tại). Mới nhất trước, keyset (created_at, thread, seq) DESC; p_limit kẹp 1..21
-- (route xin limit+1). Lọc + LIMIT trước, tên người/công ty join sau trên ≤ limit dòng. Dùng chỉ mục trigram `pmsg_messages_fold_trgm_ix` bên dưới (cùng biểu thức + điều kiện).
CREATE OR REPLACE FUNCTION hub.pmsg_search(p_pat text, p_conv uuid, p_cur_t timestamptz, p_cur_conv uuid, p_cur_seq bigint, p_limit integer)
RETURNS TABLE (
  conversation_id uuid, seq bigint, sender_user uuid, sender_name text, at timestamptz, body text,
  peer_user uuid, peer_name text, company_id uuid, company_name text
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
  v_lim integer := LEAST(GREATEST(COALESCE(p_limit, 20), 1), 21);
BEGIN
  SELECT c.tid, c.uid INTO v_tid, v_uid FROM hub.pmsg_ctx() c;
  IF p_pat IS NULL OR char_length(btrim(p_pat)) < 2 THEN
    RAISE EXCEPTION 'pmsg_search: đầu vào không hợp lệ' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  WITH h AS (
    SELECT m.thread_id AS cid, m.seq AS s, m.sender_user AS su, m.created_at AS ts, m.body AS b,
           CASE WHEN th.a_tenant = v_tid AND th.a_user = v_uid THEN th.b_tenant ELSE th.a_tenant END AS pt,
           CASE WHEN th.a_tenant = v_tid AND th.a_user = v_uid THEN th.b_user ELSE th.a_user END AS pu
      FROM hub.pmsg_messages m
      JOIN hub.pmsg_threads th ON th.id = m.thread_id
     WHERE m.deleted_at IS NULL
       AND hub.fold(m.body) LIKE '%' || hub.fold(p_pat) || '%'
       AND ((th.a_tenant = v_tid AND th.a_user = v_uid) OR (th.b_tenant = v_tid AND th.b_user = v_uid))
       AND (p_conv IS NULL OR m.thread_id = p_conv)
       AND (p_cur_t IS NULL OR p_cur_conv IS NULL OR p_cur_seq IS NULL OR (m.created_at, m.thread_id, m.seq) < (p_cur_t, p_cur_conv, p_cur_seq))
     ORDER BY m.created_at DESC, m.thread_id DESC, m.seq DESC
     LIMIT v_lim)
  SELECT h.cid, h.s, h.su, COALESCE(sn.display_name, ''), h.ts, h.b, h.pu, COALESCE(pn.display_name, ''), h.pt, COALESCE(tn.legal_name, tn.name)
    FROM h
    LEFT JOIN admin.users sn ON sn.id = h.su
    LEFT JOIN admin.users pn ON pn.id = h.pu
    LEFT JOIN admin.tenants tn ON tn.id = h.pt
   ORDER BY h.ts DESC, h.cid DESC, h.s DESC;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION hub.pmsg_search(text, uuid, timestamptz, uuid, bigint, integer) FROM PUBLIC;
--> statement-breakpoint
-- Chỉ mục trigram trên `hub.fold(body)` (tin chưa thu hồi) cho LIKE '%…%'. pg_trgm có sẵn thì tạo, thiếu/không đủ quyền ⇒ bỏ qua (hàm vẫn đúng, chỉ chậm) — cùng khuôn 0152.
-- Migration chạy trong MỘT tx ⇒ không CONCURRENTLY (ghi bảng chờ trong lúc dựng; `pmsg_messages` còn nhỏ). `lock_timeout` để không treo hàng đợi khoá nếu có phiên giữ bảng.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    BEGIN
      EXECUTE format('CREATE INDEX IF NOT EXISTS pmsg_messages_fold_trgm_ix ON hub.pmsg_messages USING gin (hub.fold(body) %I.gin_trgm_ops) WHERE deleted_at IS NULL',
                     (SELECT n.nspname FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace WHERE e.extname = 'pg_trgm'));
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'không tạo được index trigram tin nhắn đối tác (%): bỏ qua', SQLERRM;
    END;
  END IF;
END $$;

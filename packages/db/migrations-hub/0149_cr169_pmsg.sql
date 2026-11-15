-- CR-169 · lát 2a · spec §3 (P1–P7, P13, P14) · §5 (0149) · Nhắn tin 1–1 giữa nhân viên của hai công ty ĐÃ KẾT NỐI (kiểu `partner` của «Tin nhắn»).
-- (1) Gỡ trò chuyện chung CR-161: hàm `cc_thread_page/send/mark_read/file_add/file_get/unread/files_sweep/thread_ensure/msg_json/ctx` + 4 bảng `cc_*`
--     + chuông `cc.msg`. Chưa có dữ liệu thật ⇒ không backfill. GIỮ hàm kết nối 0145 (cc_invite/cc_disconnect/cc_connected/cc_connected_raw/cc_owners_raw…).
--     `cc_links` (0146 tính chưa đọc từ cc_threads) tạo lại theo 0145 NHƯNG BỎ cột `unread` (DROP + CREATE vì đổi kiểu trả về) + cấp lại quyền.
-- (2) Bảng `pmsg_threads/pmsg_messages/pmsg_files`: RLS bật KHÔNG FORCE (như 0146/0117: chủ hàm DEFINER đi qua), chỉ policy `app.scope='system'` cho hub_rw
--     ⇒ không ai đọc bảng trực tiếp ở scope người dùng; mọi đường đi qua hàm DEFINER.
-- (3) Hàm DEFINER (search_path cố định, REVOKE PUBLIC). Người dùng KHÔNG là tham số: mọi hàm gọi `hub.pmsg_ctx()` đọc `app.tenant_id` + `app.user_id`
--     (bắt buộc đặt bởi scope người dùng) và kiểm `eligible(A,u)` — thiếu/không hợp lệ ⇒ 42501 (P1). Id cuộc trò chuyện từ ngoài LUÔN được đối chiếu với
--     «u là một trong hai đầu» ⇒ người ngoài cuộc (công ty thứ ba, nhân viên khác công ty/cùng công ty) nhận CC404 MSG_NOT_FOUND, không lộ (P3).
-- Mã lỗi (SQLSTATE riêng, MESSAGE = mã nghiệp vụ; route ánh xạ theo MESSAGE): CC404 MSG_NOT_FOUND · CC403 MSG_NOT_SENDER · CC409 MSG_NOT_CONNECTED | MSG_PEER_INACTIVE ·
--     CC422 MSG_USER_INVALID | MSG_FILE_INVALID · CC400 MSG_EMPTY | MSG_TOO_LONG | MSG_TOO_MANY_FILES · 22023 đầu vào sai · 42501 không được dùng.
-- Khoá: pg_advisory_xact_lock_shared theo cặp tenant (cùng khoá `hashtextextended(least||greatest, 161)` với cc_invite/cc_disconnect của 0145, chế độ MỞ
--     cho mở/gửi: nhiều tin cùng chạy được, nhưng tuần tự với ngắt/mời) rồi `pmsg_threads … FOR UPDATE` (cấp `seq`). Thứ tự khoá luôn advisory → hàng thread.
-- Luật thuần: trùng `apps/hub-api/src/modules/packs/contracts/messages/domain/partner.rules.ts` (partnerPair, partnerReadOnly, partnerSendError).
-- Chạy lại được: DROP … IF EXISTS / CREATE … IF NOT EXISTS / CREATE OR REPLACE; GRANT lặp vô hại.

-- ── (1) Gỡ trò chuyện CR-161 ────────────────────────────────────────────────────────────────────────────────────────────────
-- Hàm theo TÊN (mọi chữ ký còn sót qua 0146/0148), trước bảng vì cc_thread_ensure/cc_msg_json dùng kiểu hàng của bảng.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'hub' AND p.proname IN ('cc_thread_page', 'cc_send', 'cc_mark_read', 'cc_file_add', 'cc_file_get', 'cc_unread',
                                                      'cc_files_sweep', 'cc_thread_ensure', 'cc_msg_json', 'cc_ctx') LOOP
    EXECUTE 'DROP FUNCTION ' || r.sig;
  END LOOP;
END $$;
--> statement-breakpoint
DROP TABLE IF EXISTS hub.cc_files;
--> statement-breakpoint
DROP TABLE IF EXISTS hub.cc_reads;
--> statement-breakpoint
DROP TABLE IF EXISTS hub.cc_messages;
--> statement-breakpoint
DROP TABLE IF EXISTS hub.cc_threads;
--> statement-breakpoint
DELETE FROM hub.notifications WHERE kind = 'cc.msg';
--> statement-breakpoint
-- cc_links: thân 0145 (không đọc bảng trò chuyện), BỎ cột `unread`. DROP vì đổi kiểu trả về; quyền cấp lại ở cuối file.
DROP FUNCTION IF EXISTS hub.cc_links(text, timestamptz, uuid, integer);
--> statement-breakpoint
CREATE FUNCTION hub.cc_links(p_status text, p_cur_t timestamptz, p_cur_id uuid, p_limit integer)
RETURNS TABLE (
  tenant_id uuid, legal_name text, tax_code text, verified boolean, status text, note text, invited_by_name text,
  since timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_tid uuid := NULLIF(current_setting('app.tenant_id', true), '')::uuid;
  v_lim integer := LEAST(GREATEST(COALESCE(p_limit, 20), 1), 101);
BEGIN
  IF v_tid IS NULL THEN
    RAISE EXCEPTION 'cc_links: chưa đặt tenant' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT x.other, t.legal_name, t.tax_code, t.directory_verified_at IS NOT NULL, x.st, x.note, x.by_name, x.ts
    FROM (
      SELECT y.other, y.st, y.note, y.by_name,
             CASE y.st WHEN 'connected' THEN GREATEST(y.o_acc, y.i_acc)
                       WHEN 'pending_out' THEN y.o_creq ELSE y.i_creq END AS ts
        FROM (
          SELECT COALESCE(o.to_tenant, i.from_tenant) AS other,
                 o.accepted_at AS o_acc, i.accepted_at AS i_acc, o.connect_requested_at AS o_creq, i.connect_requested_at AS i_creq,
                 hub.cc_status_of(o.requested_at, o.accepted_at, o.blocked_at, o.connect_requested_at,
                                  i.accepted_at, i.blocked_at, i.connect_requested_at) AS st,
                 COALESCE(o.connect_note, i.connect_note) AS note, COALESCE(o.connect_by_name, i.connect_by_name) AS by_name
            FROM (SELECT * FROM hub.partner_links WHERE from_tenant = v_tid) o
            FULL JOIN (SELECT * FROM hub.partner_links WHERE to_tenant = v_tid) i ON i.from_tenant = o.to_tenant
        ) y
    ) x
    JOIN admin.tenants t ON t.id = x.other
   WHERE x.st IN ('connected', 'pending_in', 'pending_out')
     AND (p_status IS NULL OR x.st = p_status)
     AND (p_cur_t IS NULL OR p_cur_id IS NULL OR (x.ts, x.other) < (p_cur_t, p_cur_id))
   ORDER BY x.ts DESC, x.other DESC
   LIMIT v_lim;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION hub.cc_links(text, timestamptz, uuid, integer) FROM PUBLIC;
--> statement-breakpoint

-- ── (2) Bảng ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
-- Một cuộc cho cặp người (a < b theo (tenant, user)). `a_*` = đầu có (tenant,user) nhỏ hơn; mốc đọc từng đầu nằm cùng hàng.
CREATE TABLE IF NOT EXISTS hub.pmsg_threads (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  a_tenant uuid NOT NULL,
  a_user uuid NOT NULL,
  b_tenant uuid NOT NULL,
  b_user uuid NOT NULL,
  last_seq bigint NOT NULL DEFAULT 0,
  last_at timestamptz NOT NULL DEFAULT now(),
  a_read_seq bigint NOT NULL DEFAULT 0,
  b_read_seq bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pmsg_threads_pkey PRIMARY KEY (id),
  CONSTRAINT pmsg_threads_tenant_ck CHECK (a_tenant <> b_tenant),
  CONSTRAINT pmsg_threads_order_ck CHECK ((a_tenant, a_user) < (b_tenant, b_user)),
  CONSTRAINT pmsg_threads_pair_uq UNIQUE (a_tenant, a_user, b_tenant, b_user),
  CONSTRAINT pmsg_threads_seq_ck CHECK (last_seq >= 0 AND a_read_seq >= 0 AND b_read_seq >= 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS pmsg_threads_a_ix ON hub.pmsg_threads (a_tenant, a_user, last_at DESC, id DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS pmsg_threads_b_ix ON hub.pmsg_threads (b_tenant, b_user, last_at DESC, id DESC);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS hub.pmsg_messages (
  thread_id uuid NOT NULL,
  seq bigint NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  sender_user uuid NOT NULL,
  body text NOT NULL DEFAULT '',
  files jsonb NOT NULL DEFAULT '[]'::jsonb,
  client_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT pmsg_messages_pkey PRIMARY KEY (thread_id, seq),
  CONSTRAINT pmsg_messages_client_uq UNIQUE (thread_id, sender_user, client_id),
  CONSTRAINT pmsg_messages_id_uq UNIQUE (id),
  CONSTRAINT pmsg_messages_thread_fk FOREIGN KEY (thread_id) REFERENCES hub.pmsg_threads (id) ON DELETE CASCADE,
  CONSTRAINT pmsg_messages_seq_ck CHECK (seq >= 1),
  CONSTRAINT pmsg_messages_body_ck CHECK (char_length(body) <= 4000),
  CONSTRAINT pmsg_messages_files_ck CHECK (jsonb_typeof(files) = 'array' AND jsonb_array_length(files) <= 10)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS hub.pmsg_files (
  id uuid NOT NULL,
  thread_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  user_id uuid NOT NULL,
  name text NOT NULL,
  mime text NOT NULL,
  size bigint NOT NULL,
  storage_key text NOT NULL,
  box_file_id text NOT NULL,
  seq bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT pmsg_files_pkey PRIMARY KEY (id),
  CONSTRAINT pmsg_files_thread_fk FOREIGN KEY (thread_id) REFERENCES hub.pmsg_threads (id) ON DELETE CASCADE,
  CONSTRAINT pmsg_files_name_ck CHECK (char_length(name) BETWEEN 1 AND 255),
  CONSTRAINT pmsg_files_mime_ck CHECK (char_length(mime) BETWEEN 1 AND 100),
  CONSTRAINT pmsg_files_size_ck CHECK (size BETWEEN 1 AND 20971520),
  CONSTRAINT pmsg_files_seq_ck CHECK (seq IS NULL OR seq >= 1),
  CONSTRAINT pmsg_files_key_ck CHECK (storage_key = tenant_id::text || '/' || id::text),
  CONSTRAINT pmsg_files_box_ck CHECK (box_file_id ~ '^[A-Za-z0-9_-]{1,64}$')
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS pmsg_files_thread_ix ON hub.pmsg_files (thread_id, seq);
--> statement-breakpoint
-- Việc nền dọn tệp chưa gắn tin (0150), và trần tệp chưa gắn mỗi người.
CREATE INDEX IF NOT EXISTS pmsg_files_unbound_ix ON hub.pmsg_files (created_at) WHERE seq IS NULL AND deleted_at IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS pmsg_files_pending_user_ix ON hub.pmsg_files (user_id) WHERE seq IS NULL AND deleted_at IS NULL;
--> statement-breakpoint
ALTER TABLE hub.pmsg_threads ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE hub.pmsg_messages ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE hub.pmsg_files ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['pmsg_threads', 'pmsg_messages', 'pmsg_files'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'hub' AND tablename = t AND policyname = t || '_system') THEN
      EXECUTE format($f$CREATE POLICY %I ON hub.%I FOR ALL TO hub_rw
        USING (current_setting('app.scope', true) = 'system')
        WITH CHECK (current_setting('app.scope', true) = 'system')$f$, t || '_system', t);
    END IF;
  END LOOP;
END $$;
--> statement-breakpoint

-- ── (3) Hàm nội bộ (KHÔNG GRANT cho ai; chỉ hàm DEFINER khác gọi) ──────────────────────────────────────────────────────────
-- Người hợp lệ `eligible(T, v)` (P1): thành viên đang dùng của T, KHÔNG phải external, có quyền `read` gói contracts của T — thuộc Group được cấp
-- contracts-read (hoặc write/admin, cao hơn read) còn hiệu lực (entitlement chưa thu hồi, feature ≠ off). Cùng nguồn grant với `cc_owners_raw` (0145).
CREATE OR REPLACE FUNCTION hub.pmsg_eligible_raw(p_tenant uuid, p_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM admin.users u
     WHERE u.id = p_user AND u.tenant_id = p_tenant AND u.active AND NOT u.locked_by_tenant AND u.kind <> 'external'
       AND EXISTS (SELECT 1 FROM admin.features fr
                     JOIN admin.feature_entitlements er ON er.feature_id = fr.id AND er.tenant_id = p_tenant AND er.revoked_at IS NULL
                    WHERE fr.key = 'contracts-read' AND fr.status <> 'off')
       AND EXISTS (SELECT 1 FROM admin.features fg
                     JOIN admin.feature_entitlements eg ON eg.feature_id = fg.id AND eg.tenant_id = p_tenant AND eg.revoked_at IS NULL
                     JOIN admin.feature_grants g ON g.feature_id = fg.id AND g.tenant_id = p_tenant AND g.group_id IS NOT NULL
                     JOIN admin.group_members gm ON gm.tenant_id = g.tenant_id AND gm.group_id = g.group_id AND gm.user_id = u.id
                    WHERE fg.key IN ('contracts-read', 'contracts-write', 'contracts-admin') AND fg.status <> 'off'))
$$;
--> statement-breakpoint
-- Bối cảnh người dùng (P1): BẮT BUỘC `app.tenant_id` + `app.user_id` và eligible(A,u); ngược lại 42501. Trả (tenant, user) — user không bao giờ là tham số.
CREATE OR REPLACE FUNCTION hub.pmsg_ctx()
RETURNS TABLE (tid uuid, uid uuid)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_tid uuid := NULLIF(current_setting('app.tenant_id', true), '')::uuid;
  v_uid uuid := NULLIF(current_setting('app.user_id', true), '')::uuid;
BEGIN
  IF v_tid IS NULL OR v_uid IS NULL THEN
    RAISE EXCEPTION 'pmsg_ctx: chưa đặt tenant/người dùng' USING ERRCODE = '42501';
  END IF;
  IF NOT hub.pmsg_eligible_raw(v_tid, v_uid) THEN
    RAISE EXCEPTION 'pmsg_ctx: người dùng không được nhắn tin công ty kết nối' USING ERRCODE = '42501';
  END IF;
  tid := v_tid; uid := v_uid;
  RETURN NEXT;
END $$;
--> statement-breakpoint
-- Tin → jsonb (Message của contract: id, seq, conversation_id, sender_id, client_id, body, files, at, deleted). Thu hồi ⇒ body '', files [], deleted true.
CREATE OR REPLACE FUNCTION hub.pmsg_msg_json(p_m hub.pmsg_messages)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT jsonb_build_object('id', p_m.id, 'seq', p_m.seq, 'conversation_id', p_m.thread_id, 'sender_id', p_m.sender_user,
           'client_id', p_m.client_id, 'body', CASE WHEN p_m.deleted_at IS NULL THEN p_m.body ELSE '' END,
           'files', CASE WHEN p_m.deleted_at IS NULL THEN p_m.files ELSE '[]'::jsonb END,
           'at', to_char(p_m.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), 'deleted', p_m.deleted_at IS NOT NULL)
$$;
--> statement-breakpoint
-- Một cuộc theo góc nhìn (A,u). 0 dòng nếu (A,u) KHÔNG là một trong hai đầu (nguồn duy nhất của kiểm «người trong cuộc», P3). Tên/chức vụ/công ty lấy
-- bằng join trong câu, không vòng lặp. `unread` = số tin sau mốc đọc của u, không do u gửi, chưa thu hồi — đếm trên PK, kẹp 100 (như CR-132).
CREATE OR REPLACE FUNCTION hub.pmsg_view(p_id uuid, p_tid uuid, p_uid uuid)
RETURNS TABLE (
  id uuid, peer_user uuid, peer_name text, peer_title text, peer_active boolean, company_id uuid, company_name text,
  last jsonb, unread integer, last_at timestamptz, read_only boolean, my_read_seq bigint, peer_read_seq bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT s.id, s.pu, COALESCE(pu.display_name, ''), pp.job_title, f.elig, s.pt, COALESCE(tn.legal_name, tn.name),
         CASE WHEN lm.seq IS NULL THEN NULL ELSE jsonb_build_object('seq', lm.seq, 'sender_id', lm.sender_user,
           'sender_name', COALESCE(su.display_name, ''), 'preview', lm.preview, 'has_files', lm.has_files, 'deleted', lm.deleted, 'at', lm.at) END,
         un.n, s.last_at, NOT (f.conn AND f.elig), s.my_read, s.peer_read
    FROM (SELECT th.id, th.last_at, th.last_seq,
                 CASE WHEN th.a_tenant = p_tid AND th.a_user = p_uid THEN th.b_tenant ELSE th.a_tenant END AS pt,
                 CASE WHEN th.a_tenant = p_tid AND th.a_user = p_uid THEN th.b_user ELSE th.a_user END AS pu,
                 CASE WHEN th.a_tenant = p_tid AND th.a_user = p_uid THEN th.a_read_seq ELSE th.b_read_seq END AS my_read,
                 CASE WHEN th.a_tenant = p_tid AND th.a_user = p_uid THEN th.b_read_seq ELSE th.a_read_seq END AS peer_read
            FROM hub.pmsg_threads th
           WHERE th.id = p_id AND ((th.a_tenant = p_tid AND th.a_user = p_uid) OR (th.b_tenant = p_tid AND th.b_user = p_uid))) s
    CROSS JOIN LATERAL (SELECT hub.pmsg_eligible_raw(s.pt, s.pu) AS elig, hub.cc_connected_raw(p_tid, s.pt) AS conn) f
    LEFT JOIN admin.users pu ON pu.id = s.pu
    LEFT JOIN hub.people_profiles pp ON pp.tenant_id = s.pt AND pp.user_id = s.pu
    LEFT JOIN admin.tenants tn ON tn.id = s.pt
    LEFT JOIN LATERAL (
      SELECT x.seq, x.sender_user, CASE WHEN x.deleted_at IS NULL THEN left(x.body, 240) ELSE '' END AS preview,
             x.deleted_at IS NULL AND jsonb_array_length(x.files) > 0 AS has_files, x.deleted_at IS NOT NULL AS deleted,
             to_char(x.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at
        FROM hub.pmsg_messages x WHERE x.thread_id = s.id ORDER BY x.seq DESC LIMIT 1) lm ON true
    LEFT JOIN admin.users su ON su.id = lm.sender_user
    CROSS JOIN LATERAL (
      SELECT count(*)::integer AS n FROM (
        SELECT 1 FROM hub.pmsg_messages x
         WHERE s.last_seq > s.my_read AND x.thread_id = s.id AND x.seq > s.my_read AND x.sender_user <> p_uid AND x.deleted_at IS NULL
         LIMIT 100) q) un
$$;
--> statement-breakpoint

-- ── Công khai (hub_rw, contracts_rw — GRANT ở cuối file; hub 0151 cấp lại cùng danh sách) ────────────────────────────────────────
-- P2 · mở 1–1 với (p_tenant, p_user). Không chèn tin. Cặp đã có cuộc ⇒ trả cuộc cũ (created=false).
-- Thứ tự lỗi: cùng công ty ⇒ CC422 MSG_USER_INVALID · không kết nối ⇒ CC409 MSG_NOT_CONNECTED · người kia không hợp lệ ⇒ CC422 MSG_USER_INVALID.
CREATE OR REPLACE FUNCTION hub.pmsg_open(p_tenant uuid, p_user uuid)
RETURNS TABLE (id uuid, created boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_tid uuid;
  v_uid uuid;
  v_id uuid;
  v_at uuid;
  v_au uuid;
  v_bt uuid;
  v_bu uuid;
BEGIN
  SELECT c.tid, c.uid INTO v_tid, v_uid FROM hub.pmsg_ctx() c;
  IF p_tenant IS NULL OR p_user IS NULL THEN
    RAISE EXCEPTION 'pmsg_open: đầu vào không hợp lệ' USING ERRCODE = '22023';
  END IF;
  IF p_tenant = v_tid THEN
    RAISE EXCEPTION 'MSG_USER_INVALID' USING ERRCODE = 'CC422';
  END IF;
  PERFORM pg_advisory_xact_lock_shared(hashtextextended(least(v_tid::text, p_tenant::text) || greatest(v_tid::text, p_tenant::text), 161));
  IF NOT hub.cc_connected_raw(v_tid, p_tenant) THEN
    RAISE EXCEPTION 'MSG_NOT_CONNECTED' USING ERRCODE = 'CC409';
  END IF;
  IF NOT hub.pmsg_eligible_raw(p_tenant, p_user) THEN
    RAISE EXCEPTION 'MSG_USER_INVALID' USING ERRCODE = 'CC422';
  END IF;
  -- (a_*) = đầu nhỏ hơn theo (tenant, user) — trùng partnerPair().
  IF (v_tid, v_uid) < (p_tenant, p_user) THEN
    v_at := v_tid; v_au := v_uid; v_bt := p_tenant; v_bu := p_user;
  ELSE
    v_at := p_tenant; v_au := p_user; v_bt := v_tid; v_bu := v_uid;
  END IF;
  INSERT INTO hub.pmsg_threads (a_tenant, a_user, b_tenant, b_user) VALUES (v_at, v_au, v_bt, v_bu)
  ON CONFLICT ON CONSTRAINT pmsg_threads_pair_uq DO NOTHING RETURNING pmsg_threads.id INTO v_id;
  IF v_id IS NOT NULL THEN
    id := v_id; created := true;
    RETURN NEXT;
    RETURN;
  END IF;
  SELECT t.id INTO v_id FROM hub.pmsg_threads t
   WHERE t.a_tenant = v_at AND t.a_user = v_au AND t.b_tenant = v_bt AND t.b_user = v_bu;
  id := v_id; created := false;
  RETURN NEXT;
END $$;
--> statement-breakpoint
-- P9 · danh sách cuộc của u, mới nhất trước `(last_at DESC, id DESC)`, keyset (p_cur_t, p_cur_id). p_company NULL = mọi công ty; có giá trị ⇒ chỉ cuộc có đầu
-- kia thuộc công ty đó (kể cả đã ngắt). p_limit kẹp 1..51 (route xin limit+1). Hai nhánh (u là đầu a / đầu b) mỗi nhánh đi một index `(x_tenant, x_user, last_at, id)`.
CREATE OR REPLACE FUNCTION hub.pmsg_inbox(p_company uuid, p_cur_t timestamptz, p_cur_id uuid, p_limit integer)
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
        AND (p_cur_t IS NULL OR p_cur_id IS NULL OR (t.last_at, t.id) < (p_cur_t, p_cur_id))
      ORDER BY t.last_at DESC, t.id DESC LIMIT v_lim)
    UNION ALL
    (SELECT t.id, t.last_at FROM hub.pmsg_threads t
      WHERE t.b_tenant = v_tid AND t.b_user = v_uid AND (p_company IS NULL OR t.a_tenant = p_company)
        AND (p_cur_t IS NULL OR p_cur_id IS NULL OR (t.last_at, t.id) < (p_cur_t, p_cur_id))
      ORDER BY t.last_at DESC, t.id DESC LIMIT v_lim)
  ), top AS (SELECT k.tid, k.tat FROM pick k ORDER BY k.tat DESC, k.tid DESC LIMIT v_lim)
  SELECT v.id, v.peer_user, v.peer_name, v.peer_title, v.peer_active, v.company_id, v.company_name, v.last, v.unread, v.last_at, v.read_only
    FROM top
    CROSS JOIN LATERAL hub.pmsg_view(top.tid, v_tid, v_uid) v
   ORDER BY v.last_at DESC, v.id DESC;
END $$;
--> statement-breakpoint
-- P3 · chi tiết một cuộc (như inbox + mốc đọc hai đầu). u không là đầu ⇒ CC404 MSG_NOT_FOUND (không lộ).
CREATE OR REPLACE FUNCTION hub.pmsg_detail(p_id uuid)
RETURNS TABLE (
  id uuid, peer_user uuid, peer_name text, peer_title text, peer_active boolean, company_id uuid, company_name text,
  last jsonb, unread integer, last_at timestamptz, read_only boolean, my_read_seq bigint, peer_read_seq bigint
)
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
  RETURN QUERY SELECT * FROM hub.pmsg_view(p_id, v_tid, v_uid);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'MSG_NOT_FOUND' USING ERRCODE = 'CC404';
  END IF;
END $$;
--> statement-breakpoint
-- P3 · một trang tin (seq giảm dần). p_limit kẹp 1..100; has_more = còn tin cũ hơn. Đọc được cả khi đã ngắt kết nối. u không là đầu ⇒ CC404.
CREATE OR REPLACE FUNCTION hub.pmsg_page(p_id uuid, p_before bigint, p_limit integer)
RETURNS TABLE (items jsonb, has_more boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_tid uuid;
  v_uid uuid;
  v_lim integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
  v_n integer;
BEGIN
  SELECT c.tid, c.uid INTO v_tid, v_uid FROM hub.pmsg_ctx() c;
  IF NOT EXISTS (SELECT 1 FROM hub.pmsg_threads t
                  WHERE t.id = p_id AND ((t.a_tenant = v_tid AND t.a_user = v_uid) OR (t.b_tenant = v_tid AND t.b_user = v_uid))) THEN
    RAISE EXCEPTION 'MSG_NOT_FOUND' USING ERRCODE = 'CC404';
  END IF;
  SELECT COALESCE(jsonb_agg(j.obj ORDER BY j.s DESC) FILTER (WHERE j.rn <= v_lim), '[]'::jsonb), COALESCE(max(j.rn), 0)
    INTO items, v_n
    FROM (SELECT m.seq AS s, hub.pmsg_msg_json(m) AS obj, row_number() OVER (ORDER BY m.seq DESC)::integer AS rn
            FROM hub.pmsg_messages m
           WHERE m.thread_id = p_id AND (p_before IS NULL OR m.seq < p_before)
           ORDER BY m.seq DESC
           LIMIT v_lim + 1) j;
  has_more := v_n > v_lim;
  RETURN NEXT;
END $$;
--> statement-breakpoint
-- P4 · gửi tin: MỘT lần gọi. Chỉ khi connected(A,B) rồi eligible(B,v) (thứ tự = partnerSendError). Trả (seq, created, message, notify):
-- created=false ⇒ gửi lặp cùng client_id: tin cũ, không tăng seq, notify=[]. notify = [{tenant_id,user_id}] hai đầu (route phát `msg.new`, gồm tab khác của người gửi).
-- Tệp: chỉ tệp của chính người gửi, cùng cuộc, chưa gắn tin, chưa xoá, không trùng id; sai ⇒ CC422 MSG_FILE_INVALID. Tiến mốc đọc của người gửi tới tin vừa gửi.
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
  IF NOT hub.cc_connected_raw(v_tid, v_pt) THEN
    RAISE EXCEPTION 'MSG_NOT_CONNECTED' USING ERRCODE = 'CC409';
  END IF;
  IF NOT hub.pmsg_eligible_raw(v_pt, v_pu) THEN
    RAISE EXCEPTION 'MSG_PEER_INACTIVE' USING ERRCODE = 'CC409';
  END IF;
  SELECT * INTO th FROM hub.pmsg_threads t WHERE t.id = p_id FOR UPDATE;
  -- Gửi lặp: trả tin cũ.
  SELECT * INTO m FROM hub.pmsg_messages x WHERE x.thread_id = p_id AND x.sender_user = v_uid AND x.client_id = p_client_id;
  IF FOUND THEN
    seq := m.seq; created := false; message := hub.pmsg_msg_json(m); notify := '[]'::jsonb;
    RETURN NEXT;
    RETURN;
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
  UPDATE hub.pmsg_files f SET seq = v_seq WHERE f.id = ANY (v_ids) AND f.thread_id = p_id;
  seq := v_seq; created := true; message := hub.pmsg_msg_json(m);
  notify := jsonb_build_array(jsonb_build_object('tenant_id', v_tid, 'user_id', v_uid), jsonb_build_object('tenant_id', v_pt, 'user_id', v_pu));
  RETURN NEXT;
END $$;
--> statement-breakpoint
-- P5 · thu hồi tin của chính mình, mọi lúc (cả sau ngắt): body '', files [], deleted_at; tệp đã gắn đánh dấu xoá và TRẢ id FileBox để route gỡ byte.
-- Không phải người gửi ⇒ CC403 MSG_NOT_SENDER; không có cuộc/tin ⇒ CC404. Đã thu hồi ⇒ trả mảng rỗng (idempotent).
CREATE OR REPLACE FUNCTION hub.pmsg_delete(p_id uuid, p_seq bigint)
RETURNS text[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_tid uuid;
  v_uid uuid;
  v_sender uuid;
  v_del timestamptz;
  v_box text[];
BEGIN
  SELECT c.tid, c.uid INTO v_tid, v_uid FROM hub.pmsg_ctx() c;
  IF p_id IS NULL OR p_seq IS NULL OR p_seq < 1 THEN
    RAISE EXCEPTION 'pmsg_delete: đầu vào không hợp lệ' USING ERRCODE = '22023';
  END IF;
  SELECT x.sender_user, x.deleted_at INTO v_sender, v_del
    FROM hub.pmsg_messages x JOIN hub.pmsg_threads t ON t.id = x.thread_id
   WHERE x.thread_id = p_id AND x.seq = p_seq
     AND ((t.a_tenant = v_tid AND t.a_user = v_uid) OR (t.b_tenant = v_tid AND t.b_user = v_uid));
  IF v_sender IS NULL THEN
    RAISE EXCEPTION 'MSG_NOT_FOUND' USING ERRCODE = 'CC404';
  END IF;
  IF v_sender <> v_uid THEN
    RAISE EXCEPTION 'MSG_NOT_SENDER' USING ERRCODE = 'CC403';
  END IF;
  IF v_del IS NOT NULL THEN
    RETURN '{}'::text[];
  END IF;
  UPDATE hub.pmsg_messages x SET body = '', files = '[]'::jsonb, deleted_at = now() WHERE x.thread_id = p_id AND x.seq = p_seq;
  WITH u AS (
    UPDATE hub.pmsg_files f SET deleted_at = now() WHERE f.thread_id = p_id AND f.seq = p_seq AND f.deleted_at IS NULL RETURNING f.box_file_id AS b)
  SELECT COALESCE(array_agg(u.b), '{}'::text[]) INTO v_box FROM u;
  RETURN v_box;
END $$;
--> statement-breakpoint
-- P6 · đã đọc: mốc chỉ tiến, kẹp ≤ last_seq (trùng clampRead CR-132). Trả mốc mới của u. Không đổi gì (đã đọc tới đó) ⇒ không ghi hàng.
CREATE OR REPLACE FUNCTION hub.pmsg_mark_read(p_id uuid, p_seq bigint)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_tid uuid;
  v_uid uuid;
  v_cur bigint;
BEGIN
  SELECT c.tid, c.uid INTO v_tid, v_uid FROM hub.pmsg_ctx() c;
  IF p_id IS NULL OR p_seq IS NULL OR p_seq < 0 THEN
    RAISE EXCEPTION 'pmsg_mark_read: đầu vào không hợp lệ' USING ERRCODE = '22023';
  END IF;
  UPDATE hub.pmsg_threads t
     SET a_read_seq = CASE WHEN t.a_tenant = v_tid AND t.a_user = v_uid THEN GREATEST(t.a_read_seq, LEAST(p_seq, t.last_seq)) ELSE t.a_read_seq END,
         b_read_seq = CASE WHEN t.a_tenant = v_tid AND t.a_user = v_uid THEN t.b_read_seq ELSE GREATEST(t.b_read_seq, LEAST(p_seq, t.last_seq)) END
   WHERE t.id = p_id
     AND ((t.a_tenant = v_tid AND t.a_user = v_uid AND t.a_read_seq < LEAST(p_seq, t.last_seq))
       OR (t.b_tenant = v_tid AND t.b_user = v_uid AND t.b_read_seq < LEAST(p_seq, t.last_seq)))
  RETURNING CASE WHEN t.a_tenant = v_tid AND t.a_user = v_uid THEN t.a_read_seq ELSE t.b_read_seq END INTO v_cur;
  IF v_cur IS NULL THEN
    SELECT CASE WHEN t.a_tenant = v_tid AND t.a_user = v_uid THEN t.a_read_seq ELSE t.b_read_seq END INTO v_cur
      FROM hub.pmsg_threads t
     WHERE t.id = p_id AND ((t.a_tenant = v_tid AND t.a_user = v_uid) OR (t.b_tenant = v_tid AND t.b_user = v_uid));
    IF v_cur IS NULL THEN
      RAISE EXCEPTION 'MSG_NOT_FOUND' USING ERRCODE = 'CC404';
    END IF;
  END IF;
  RETURN v_cur;
END $$;
--> statement-breakpoint
-- Tổng chưa đọc của u trên mọi cuộc `partner`, kẹp 999 (cùng luật đếm với inbox: kẹp 100 mỗi cuộc, bỏ cuộc đã đọc hết, dừng sớm ở 999).
CREATE OR REPLACE FUNCTION hub.pmsg_unread()
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_tid uuid;
  v_uid uuid;
  v_n integer;
BEGIN
  SELECT c.tid, c.uid INTO v_tid, v_uid FROM hub.pmsg_ctx() c;
  SELECT count(*)::integer INTO v_n FROM (
    SELECT 1 FROM (
      SELECT t.id AS tid, t.a_read_seq AS rd FROM hub.pmsg_threads t
       WHERE t.a_tenant = v_tid AND t.a_user = v_uid AND t.last_seq > t.a_read_seq
      UNION ALL
      SELECT t.id, t.b_read_seq FROM hub.pmsg_threads t
       WHERE t.b_tenant = v_tid AND t.b_user = v_uid AND t.last_seq > t.b_read_seq) k
    CROSS JOIN LATERAL (
      SELECT 1 FROM hub.pmsg_messages x
       WHERE x.thread_id = k.tid AND x.seq > k.rd AND x.sender_user <> v_uid AND x.deleted_at IS NULL LIMIT 100) u
    LIMIT 999) s;
  RETURN v_n;
END $$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION hub.pmsg_eligible_raw(uuid, uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION hub.pmsg_ctx() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION hub.pmsg_msg_json(hub.pmsg_messages) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION hub.pmsg_view(uuid, uuid, uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION hub.pmsg_open(uuid, uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION hub.pmsg_inbox(uuid, timestamptz, uuid, integer) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION hub.pmsg_detail(uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION hub.pmsg_page(uuid, bigint, integer) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION hub.pmsg_send(uuid, uuid, text, uuid[]) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION hub.pmsg_delete(uuid, bigint) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION hub.pmsg_mark_read(uuid, bigint) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION hub.pmsg_unread() FROM PUBLIC;
--> statement-breakpoint

-- ── Quyền ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
-- hub_rw (hub-api, scope user) và, khi role đã có, `contracts_rw` (tạo SAU hub ⇒ khối DO; DB dựng sạch cấp lại ở migration gói — lát 2b). Chỉ hai role (P12).
-- Bảng: chỉ SELECT cho hub_rw, vẫn bị policy `app.scope='system'` chặn ở scope người dùng. Hàm nội bộ (eligible_raw, ctx, msg_json, view) KHÔNG cấp.
-- `cc_links` bị DROP ở trên ⇒ cấp lại như 0145.
GRANT SELECT ON hub.pmsg_threads, hub.pmsg_messages, hub.pmsg_files TO hub_rw;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION hub.cc_links(text, timestamptz, uuid, integer),
  hub.pmsg_open(uuid, uuid), hub.pmsg_inbox(uuid, timestamptz, uuid, integer), hub.pmsg_detail(uuid), hub.pmsg_page(uuid, bigint, integer),
  hub.pmsg_send(uuid, uuid, text, uuid[]), hub.pmsg_delete(uuid, bigint), hub.pmsg_mark_read(uuid, bigint), hub.pmsg_unread() TO hub_rw;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'contracts_rw') THEN
    GRANT USAGE ON SCHEMA hub TO contracts_rw;
    GRANT EXECUTE ON FUNCTION hub.cc_links(text, timestamptz, uuid, integer),
      hub.pmsg_open(uuid, uuid), hub.pmsg_inbox(uuid, timestamptz, uuid, integer), hub.pmsg_detail(uuid), hub.pmsg_page(uuid, bigint, integer),
      hub.pmsg_send(uuid, uuid, text, uuid[]), hub.pmsg_delete(uuid, bigint), hub.pmsg_mark_read(uuid, bigint), hub.pmsg_unread() TO contracts_rw;
  END IF;
END $$;

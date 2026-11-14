-- CR-161 · lát 3 · spec §2 R8–R9, R11 · §4 (0146) · Trò chuyện giữa hai công ty đã kết nối + tệp đính kèm.
-- Một luồng duy nhất cho cặp (tenant_lo < tenant_hi), tạo lười ở tin/tệp đầu. Đọc: A thuộc cặp (kể cả đã ngắt). Gửi/tải lên: chỉ khi connected (0145).
-- Bốn bảng chỉ có policy `app.scope='system'` (như `partner_links` 0117, RLS bật KHÔNG FORCE: chủ hàm DEFINER đi qua); người dùng/gói chỉ đi qua hàm DEFINER.
-- Luồng LUÔN suy từ (app.tenant_id, p_other) — không nhận id luồng từ ngoài ⇒ công ty thứ ba không thể trỏ tới luồng của cặp khác.
-- Mỗi hàm theo người dùng gọi `hub.cc_ctx(p_user)`: có app.tenant_id, p_user = app.user_id (nếu đã đặt) và là người Toàn quyền (R1) của công ty — nếu không ⇒ 42501.
-- Mã lỗi: CC409 (MESSAGE CONNECT_READ_ONLY) · CC404 (CONNECT_NO_THREAD) · CC422 (MSG_EMPTY | MSG_FILE_INVALID) · 22023 (đầu vào sai, MSG_TOO_LONG | MSG_TOO_MANY_FILES).
-- Khoá: pg_advisory_xact_lock theo cặp (cùng khoá với cc_invite/cc_disconnect của 0145 ⇒ gửi và ngắt tuần tự) rồi `cc_threads … FOR UPDATE`.
-- Luật thuần trùng `connect.rules.ts` (validateChatMessage, ccDedupKey, pairOf).

CREATE TABLE IF NOT EXISTS hub.cc_threads (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_lo uuid NOT NULL,
  tenant_hi uuid NOT NULL,
  last_seq bigint NOT NULL DEFAULT 0,
  last_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cc_threads_pkey PRIMARY KEY (id),
  CONSTRAINT cc_threads_order_ck CHECK (tenant_lo < tenant_hi),
  CONSTRAINT cc_threads_pair_uq UNIQUE (tenant_lo, tenant_hi),
  CONSTRAINT cc_threads_seq_ck CHECK (last_seq >= 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS cc_threads_lo_ix ON hub.cc_threads (tenant_lo, last_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS cc_threads_hi_ix ON hub.cc_threads (tenant_hi, last_at DESC);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS hub.cc_messages (
  thread_id uuid NOT NULL,
  seq bigint NOT NULL,
  sender_tenant uuid NOT NULL,
  sender_user uuid NOT NULL,
  sender_name text NOT NULL,
  body text NOT NULL DEFAULT '',
  files jsonb NOT NULL DEFAULT '[]'::jsonb,
  client_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cc_messages_pkey PRIMARY KEY (thread_id, seq),
  CONSTRAINT cc_messages_client_uq UNIQUE (thread_id, sender_user, client_id),
  CONSTRAINT cc_messages_thread_fk FOREIGN KEY (thread_id) REFERENCES hub.cc_threads (id) ON DELETE CASCADE,
  CONSTRAINT cc_messages_seq_ck CHECK (seq >= 1),
  CONSTRAINT cc_messages_name_ck CHECK (char_length(sender_name) BETWEEN 1 AND 200),
  CONSTRAINT cc_messages_body_ck CHECK (char_length(body) <= 4000),
  CONSTRAINT cc_messages_files_ck CHECK (jsonb_typeof(files) = 'array' AND jsonb_array_length(files) <= 10)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS hub.cc_reads (
  thread_id uuid NOT NULL,
  user_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  last_read_seq bigint NOT NULL DEFAULT 0,
  CONSTRAINT cc_reads_pkey PRIMARY KEY (thread_id, user_id),
  CONSTRAINT cc_reads_thread_fk FOREIGN KEY (thread_id) REFERENCES hub.cc_threads (id) ON DELETE CASCADE,
  CONSTRAINT cc_reads_seq_ck CHECK (last_read_seq >= 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS hub.cc_files (
  id uuid NOT NULL,
  thread_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  user_id uuid NOT NULL,
  name text NOT NULL,
  mime text NOT NULL,
  size bigint NOT NULL,
  storage_key text NOT NULL,
  seq bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT cc_files_pkey PRIMARY KEY (id),
  CONSTRAINT cc_files_thread_fk FOREIGN KEY (thread_id) REFERENCES hub.cc_threads (id) ON DELETE CASCADE,
  CONSTRAINT cc_files_name_ck CHECK (char_length(name) BETWEEN 1 AND 255),
  CONSTRAINT cc_files_mime_ck CHECK (char_length(mime) BETWEEN 1 AND 100),
  CONSTRAINT cc_files_size_ck CHECK (size BETWEEN 1 AND 20971520),
  CONSTRAINT cc_files_seq_ck CHECK (seq IS NULL OR seq >= 1),
  -- Khoá lưu trữ theo công ty bên tải (như attachments_key_ck 0007).
  CONSTRAINT cc_files_key_ck CHECK (storage_key = tenant_id::text || '/' || id::text)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS cc_files_thread_ix ON hub.cc_files (thread_id, seq);
--> statement-breakpoint
-- Việc nền dọn tệp chưa gắn tin sau 24 h (R11).
CREATE INDEX IF NOT EXISTS cc_files_unbound_ix ON hub.cc_files (created_at) WHERE seq IS NULL AND deleted_at IS NULL;
--> statement-breakpoint
ALTER TABLE hub.cc_threads ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE hub.cc_messages ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE hub.cc_reads ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE hub.cc_files ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['cc_threads', 'cc_messages', 'cc_reads', 'cc_files'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'hub' AND tablename = t AND policyname = t || '_system') THEN
      EXECUTE format($f$CREATE POLICY %I ON hub.%I FOR ALL TO hub_rw
        USING (current_setting('app.scope', true) = 'system')
        WITH CHECK (current_setting('app.scope', true) = 'system')$f$, t || '_system', t);
    END IF;
  END LOOP;
END $$;
--> statement-breakpoint

-- ── Nội bộ (KHÔNG GRANT cho ai; chỉ hàm DEFINER khác gọi) ──────────────────────────────────────────────────────────────────
-- Bối cảnh người dùng: trả app.tenant_id nếu p_user là người Toàn quyền của nó (và khớp app.user_id khi đã đặt); ngược lại 42501.
CREATE OR REPLACE FUNCTION hub.cc_ctx(p_user uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_tid uuid := NULLIF(current_setting('app.tenant_id', true), '')::uuid;
  v_uid uuid := NULLIF(current_setting('app.user_id', true), '')::uuid;
BEGIN
  IF v_tid IS NULL THEN
    RAISE EXCEPTION 'cc_ctx: chưa đặt tenant' USING ERRCODE = '42501';
  END IF;
  IF p_user IS NULL OR (v_uid IS NOT NULL AND v_uid <> p_user)
     OR NOT EXISTS (SELECT 1 FROM hub.cc_owners_raw(ARRAY[v_tid]) w WHERE w.user_id = p_user) THEN
    RAISE EXCEPTION 'cc_ctx: chỉ người Toàn quyền được dùng trò chuyện công ty' USING ERRCODE = '42501';
  END IF;
  RETURN v_tid;
END $$;
--> statement-breakpoint
-- Luồng của cặp, tạo lười, khoá dòng (FOR UPDATE). Gọi sau khi giữ khoá advisory của cặp.
CREATE OR REPLACE FUNCTION hub.cc_thread_ensure(p_a uuid, p_b uuid)
RETURNS hub.cc_threads
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  r hub.cc_threads;
BEGIN
  INSERT INTO hub.cc_threads (tenant_lo, tenant_hi) VALUES (LEAST(p_a, p_b), GREATEST(p_a, p_b))
  ON CONFLICT ON CONSTRAINT cc_threads_pair_uq DO NOTHING;
  SELECT * INTO r FROM hub.cc_threads t WHERE t.tenant_lo = LEAST(p_a, p_b) AND t.tenant_hi = GREATEST(p_a, p_b) FOR UPDATE;
  RETURN r;
END $$;
--> statement-breakpoint
-- Tin → jsonb (CcMessage của spec §3). `mine` = tin do công ty đang thao tác (p_tid) gửi.
CREATE OR REPLACE FUNCTION hub.cc_msg_json(p_m hub.cc_messages, p_company text, p_tid uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT jsonb_build_object('seq', p_m.seq, 'sender_tenant', p_m.sender_tenant, 'sender_name', p_m.sender_name,
           'sender_company', COALESCE(p_company, ''), 'body', p_m.body, 'files', p_m.files,
           'created_at', p_m.created_at, 'mine', p_m.sender_tenant = p_tid)
$$;
--> statement-breakpoint

-- ── Công khai (hub_rw, contracts_rw — GRANT ở 0147) ──────────────────────────────────────────────────────────────────────────
-- Một trang tin (seq giảm dần, p_limit kẹp 1..101 — route xin limit+1 để biết còn trang). Một dòng: read_only, last_read_seq của p_user, items (mảng CcMessage).
-- Chưa có luồng: đang connected ⇒ trống; chưa từng kết nối ⇒ CC404 CONNECT_NO_THREAD.
CREATE OR REPLACE FUNCTION hub.cc_thread_page(p_other uuid, p_user uuid, p_before bigint, p_limit integer)
RETURNS TABLE (read_only boolean, last_read_seq bigint, items jsonb)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_tid uuid;
  v_th uuid;
  v_lim integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 101);
BEGIN
  v_tid := hub.cc_ctx(p_user);
  IF p_other IS NULL OR p_other = v_tid THEN
    RAISE EXCEPTION 'cc_thread_page: công ty không hợp lệ' USING ERRCODE = '22023';
  END IF;
  SELECT t.id INTO v_th FROM hub.cc_threads t
   WHERE t.tenant_lo = LEAST(v_tid, p_other) AND t.tenant_hi = GREATEST(v_tid, p_other);
  IF v_th IS NULL THEN
    IF NOT hub.cc_connected_raw(v_tid, p_other) THEN
      RAISE EXCEPTION 'CONNECT_NO_THREAD' USING ERRCODE = 'CC404';
    END IF;
    read_only := false; last_read_seq := 0; items := '[]'::jsonb;
    RETURN NEXT;
    RETURN;
  END IF;
  read_only := NOT hub.cc_connected_raw(v_tid, p_other);
  SELECT COALESCE(max(r.last_read_seq), 0) INTO last_read_seq FROM hub.cc_reads r
   WHERE r.thread_id = v_th AND r.user_id = p_user;
  SELECT COALESCE(jsonb_agg(j.obj ORDER BY j.s DESC), '[]'::jsonb) INTO items
    FROM (SELECT m.seq AS s, hub.cc_msg_json(m, COALESCE(t.legal_name, t.name), v_tid) AS obj
            FROM hub.cc_messages m
            LEFT JOIN admin.tenants t ON t.id = m.sender_tenant
           WHERE m.thread_id = v_th AND (p_before IS NULL OR m.seq < p_before)
           ORDER BY m.seq DESC
           LIMIT v_lim) j;
  RETURN NEXT;
END $$;
--> statement-breakpoint
-- R8 · gửi tin: MỘT lần gọi. Trả (thread_id, seq, created, message, notify). created=false ⇒ gửi lặp cùng client_id: tin cũ, không tăng seq, không chuông, notify=[].
-- notify = [{tenant_id, user_id}] mọi người Toàn quyền của CẢ HAI công ty (route phát `cc.msg` /me/stream, gồm tab khác của người gửi).
-- Chuông (R9) chèn thẳng cho người Toàn quyền công ty nhận, dedup 'cc.msg:<thread>:<last_read_seq của họ>' (fanout_at = now() ⇒ không email/push).
-- Tệp: chỉ tệp của chính p_user, cùng luồng, chưa gắn tin, chưa xoá, không trùng id; sai ⇒ CC422 MSG_FILE_INVALID.
CREATE OR REPLACE FUNCTION hub.cc_send(
  p_other uuid, p_client_id uuid, p_user uuid, p_user_name text, p_body text, p_file_ids uuid[]
) RETURNS TABLE (thread_id uuid, seq bigint, created boolean, message jsonb, notify jsonb)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_tid uuid;
  v_ids uuid[] := COALESCE(p_file_ids, '{}'::uuid[]);
  v_body text := COALESCE(p_body, '');
  v_name text := COALESCE(NULLIF(left(btrim(COALESCE(p_user_name, '')), 200), ''), 'Người dùng');
  v_company text;
  v_files jsonb;
  v_nf integer;
  v_seq bigint;
  th hub.cc_threads;
  m hub.cc_messages;
BEGIN
  v_tid := hub.cc_ctx(p_user);
  IF p_other IS NULL OR p_other = v_tid OR p_client_id IS NULL THEN
    RAISE EXCEPTION 'cc_send: đầu vào không hợp lệ' USING ERRCODE = '22023';
  END IF;
  IF char_length(v_body) > 4000 THEN
    RAISE EXCEPTION 'MSG_TOO_LONG' USING ERRCODE = '22023';
  END IF;
  IF cardinality(v_ids) > 10 THEN
    RAISE EXCEPTION 'MSG_TOO_MANY_FILES' USING ERRCODE = '22023';
  END IF;
  IF btrim(v_body) = '' AND cardinality(v_ids) = 0 THEN
    RAISE EXCEPTION 'MSG_EMPTY' USING ERRCODE = 'CC422';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(least(v_tid::text, p_other::text) || greatest(v_tid::text, p_other::text), 161));
  IF NOT hub.cc_connected_raw(v_tid, p_other) THEN
    RAISE EXCEPTION 'CONNECT_READ_ONLY' USING ERRCODE = 'CC409';
  END IF;
  th := hub.cc_thread_ensure(v_tid, p_other);
  SELECT COALESCE(t.legal_name, t.name) INTO v_company FROM admin.tenants t WHERE t.id = v_tid;
  -- Gửi lặp: trả tin cũ.
  SELECT * INTO m FROM hub.cc_messages x WHERE x.thread_id = th.id AND x.sender_user = p_user AND x.client_id = p_client_id;
  IF FOUND THEN
    thread_id := th.id; seq := m.seq; created := false;
    message := hub.cc_msg_json(m, v_company, v_tid); notify := '[]'::jsonb;
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
      JOIN hub.cc_files f ON f.id = u.fid AND f.thread_id = th.id AND f.tenant_id = v_tid AND f.user_id = p_user
                         AND f.seq IS NULL AND f.deleted_at IS NULL;
    IF v_nf <> cardinality(v_ids) THEN
      RAISE EXCEPTION 'MSG_FILE_INVALID' USING ERRCODE = 'CC422';
    END IF;
  END IF;
  v_seq := th.last_seq + 1;
  INSERT INTO hub.cc_messages (thread_id, seq, sender_tenant, sender_user, sender_name, body, files, client_id)
  VALUES (th.id, v_seq, v_tid, p_user, v_name, v_body, v_files, p_client_id)
  RETURNING * INTO m;
  UPDATE hub.cc_threads t SET last_seq = v_seq, last_at = now() WHERE t.id = th.id;
  UPDATE hub.cc_files f SET seq = v_seq WHERE f.id = ANY (v_ids) AND f.thread_id = th.id;
  -- Người gửi coi như đã đọc tới tin của mình.
  INSERT INTO hub.cc_reads AS r (thread_id, user_id, tenant_id, last_read_seq) VALUES (th.id, p_user, v_tid, v_seq)
  ON CONFLICT ON CONSTRAINT cc_reads_pkey DO UPDATE SET last_read_seq = GREATEST(r.last_read_seq, EXCLUDED.last_read_seq);
  -- Chuông cho người Toàn quyền công ty nhận + danh sách người nhận stream của cả hai công ty: MỘT câu.
  WITH own AS MATERIALIZED (
    SELECT o.tenant_id AS o_t, o.user_id AS o_u FROM hub.cc_owners_raw(ARRAY[v_tid, p_other]) o
  ), ins AS (
    INSERT INTO hub.notifications (tenant_id, user_id, source, kind, title, body, link, dedup_key, fanout_at)
    SELECT p_other, own.o_u, 'contracts', 'cc.msg', left('Tin nhắn mới từ ' || COALESCE(v_company, 'Công ty'), 200), '',
           '/contracts/partners?party=' || hub.cc_urlenc(v_company) || '&tenant=' || v_tid || '&tab=chat',
           left('cc.msg:' || th.id || ':' || COALESCE(rd.last_read_seq, 0), 128), now()
      FROM own
      LEFT JOIN hub.cc_reads rd ON rd.thread_id = th.id AND rd.user_id = own.o_u
     WHERE own.o_t = p_other
    ON CONFLICT ON CONSTRAINT notifications_dedup_uq DO NOTHING
    RETURNING 1)
  SELECT COALESCE(jsonb_agg(jsonb_build_object('tenant_id', own.o_t, 'user_id', own.o_u)), '[]'::jsonb)
    INTO notify FROM own;
  thread_id := th.id; seq := v_seq; created := true; message := hub.cc_msg_json(m, v_company, v_tid);
  RETURN NEXT;
END $$;
--> statement-breakpoint
-- Đánh dấu đã đọc: chỉ tiến, kẹp ≤ last_seq. Chưa có luồng ⇒ 0. Đọc được cả khi đã ngắt. Trả last_read_seq mới.
CREATE OR REPLACE FUNCTION hub.cc_mark_read(p_other uuid, p_user uuid, p_seq bigint)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_tid uuid;
  v_th uuid;
  v_last bigint;
  v_cur bigint;
BEGIN
  v_tid := hub.cc_ctx(p_user);
  IF p_other IS NULL OR p_other = v_tid OR p_seq IS NULL OR p_seq < 0 THEN
    RAISE EXCEPTION 'cc_mark_read: đầu vào không hợp lệ' USING ERRCODE = '22023';
  END IF;
  SELECT t.id, t.last_seq INTO v_th, v_last FROM hub.cc_threads t
   WHERE t.tenant_lo = LEAST(v_tid, p_other) AND t.tenant_hi = GREATEST(v_tid, p_other);
  IF v_th IS NULL THEN
    RETURN 0;
  END IF;
  INSERT INTO hub.cc_reads AS r (thread_id, user_id, tenant_id, last_read_seq) VALUES (v_th, p_user, v_tid, LEAST(p_seq, v_last))
  ON CONFLICT ON CONSTRAINT cc_reads_pkey DO UPDATE SET last_read_seq = GREATEST(r.last_read_seq, EXCLUDED.last_read_seq)
  RETURNING r.last_read_seq INTO v_cur;
  RETURN v_cur;
END $$;
--> statement-breakpoint
-- R11 · ghi tệp tải lên (route đã lưu nội dung; id + storage_key do route sinh, key = '<tenant bên tải>/<id>'). Chỉ khi connected, ngược lại CC409.
CREATE OR REPLACE FUNCTION hub.cc_file_add(
  p_other uuid, p_user uuid, p_id uuid, p_name text, p_mime text, p_size bigint, p_storage_key text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_tid uuid;
  th hub.cc_threads;
BEGIN
  v_tid := hub.cc_ctx(p_user);
  IF p_other IS NULL OR p_other = v_tid OR p_id IS NULL THEN
    RAISE EXCEPTION 'cc_file_add: đầu vào không hợp lệ' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(least(v_tid::text, p_other::text) || greatest(v_tid::text, p_other::text), 161));
  IF NOT hub.cc_connected_raw(v_tid, p_other) THEN
    RAISE EXCEPTION 'CONNECT_READ_ONLY' USING ERRCODE = 'CC409';
  END IF;
  th := hub.cc_thread_ensure(v_tid, p_other);
  INSERT INTO hub.cc_files (id, thread_id, tenant_id, user_id, name, mime, size, storage_key)
  VALUES (p_id, th.id, v_tid, p_user, p_name, p_mime, p_size, p_storage_key);
  RETURN jsonb_build_object('id', p_id, 'name', p_name, 'mime', p_mime, 'size', p_size);
END $$;
--> statement-breakpoint
-- R11 · khoá lưu trữ của tệp: chỉ người Toàn quyền của một trong hai công ty trong cặp; tệp chưa gắn tin chỉ người tải thấy. Không thấy ⇒ NULL (route 404, không lộ).
-- Đã ngắt vẫn tải được tệp của tin cũ (chỉ đọc).
CREATE OR REPLACE FUNCTION hub.cc_file_get(p_file_id uuid, p_user uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_tid uuid;
  v_key text;
BEGIN
  v_tid := hub.cc_ctx(p_user);
  SELECT f.storage_key INTO v_key
    FROM hub.cc_files f JOIN hub.cc_threads t ON t.id = f.thread_id
   WHERE f.id = p_file_id AND f.deleted_at IS NULL AND v_tid IN (t.tenant_lo, t.tenant_hi)
     AND (f.seq IS NOT NULL OR f.user_id = p_user);
  RETURN v_key;
END $$;
--> statement-breakpoint
-- Chưa đọc cho cc_links: MỘT câu theo lô công ty (≤ 100), = last_seq − last_read_seq (không đếm tin). Tin của chính mình đã tính vào last_read_seq.
CREATE OR REPLACE FUNCTION hub.cc_unread(p_others uuid[], p_user uuid)
RETURNS TABLE (other_tenant uuid, unread integer)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_tid uuid;
BEGIN
  v_tid := hub.cc_ctx(p_user);
  IF p_others IS NULL OR cardinality(p_others) > 100 THEN
    RAISE EXCEPTION 'cc_unread: mảng công ty không hợp lệ' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  SELECT x.o, GREATEST(x.ls - COALESCE(rd.last_read_seq, 0), 0)::integer
    FROM (SELECT th.id AS tid, th.last_seq AS ls, th.tenant_hi AS o FROM hub.cc_threads th
           WHERE th.tenant_lo = v_tid AND th.tenant_hi = ANY (p_others)
          UNION ALL
          SELECT th.id, th.last_seq, th.tenant_lo FROM hub.cc_threads th
           WHERE th.tenant_hi = v_tid AND th.tenant_lo = ANY (p_others)) x
    LEFT JOIN hub.cc_reads rd ON rd.thread_id = x.tid AND rd.user_id = p_user;
END $$;
--> statement-breakpoint
-- Thay thân `hub.cc_links` (0145) cùng chữ ký: `unread` thật theo app.user_id (đặt bởi scope người dùng; chưa đặt ⇒ 0). Một câu, không đếm tin.
CREATE OR REPLACE FUNCTION hub.cc_links(p_status text, p_cur_t timestamptz, p_cur_id uuid, p_limit integer)
RETURNS TABLE (
  tenant_id uuid, legal_name text, tax_code text, verified boolean, status text, note text, invited_by_name text,
  since timestamptz, unread integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_tid uuid := NULLIF(current_setting('app.tenant_id', true), '')::uuid;
  v_uid uuid := NULLIF(current_setting('app.user_id', true), '')::uuid;
  v_lim integer := LEAST(GREATEST(COALESCE(p_limit, 20), 1), 101);
BEGIN
  IF v_tid IS NULL THEN
    RAISE EXCEPTION 'cc_links: chưa đặt tenant' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT p.other, p.lname, p.tax, p.ver, p.st, p.note, p.by_name, p.ts,
         CASE WHEN v_uid IS NULL THEN 0 ELSE COALESCE(u.n, 0) END
    FROM (
      SELECT x.other, t.legal_name AS lname, t.tax_code AS tax, t.directory_verified_at IS NOT NULL AS ver,
             x.st, x.note, x.by_name, x.ts
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
       LIMIT v_lim
    ) p
    LEFT JOIN LATERAL (
      SELECT GREATEST(th.last_seq - COALESCE(rd.last_read_seq, 0), 0)::integer AS n
        FROM hub.cc_threads th
        LEFT JOIN hub.cc_reads rd ON rd.thread_id = th.id AND rd.user_id = v_uid
       WHERE th.tenant_lo = LEAST(v_tid, p.other) AND th.tenant_hi = GREATEST(v_tid, p.other)
    ) u ON true
   ORDER BY p.ts DESC, p.other DESC;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION hub.cc_ctx(uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION hub.cc_thread_ensure(uuid, uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION hub.cc_msg_json(hub.cc_messages, text, uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION hub.cc_thread_page(uuid, uuid, bigint, integer) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION hub.cc_send(uuid, uuid, uuid, text, text, uuid[]) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION hub.cc_mark_read(uuid, uuid, bigint) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION hub.cc_file_add(uuid, uuid, uuid, text, text, bigint, text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION hub.cc_file_get(uuid, uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION hub.cc_unread(uuid[], uuid) FROM PUBLIC;

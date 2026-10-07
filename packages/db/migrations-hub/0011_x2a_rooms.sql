-- HUB-FR-96 · HUB-BR-22 · X2a-AC01 (plan-db X2a §4, plan §1 D2–D6, D9): phòng chat DM/nhóm — 3 bảng, FK kép tenant,
-- EXCLUDE 1 owner, 5 hàm SECURITY DEFINER, RLS 3 bảng (chỉ hub_rw, không nhánh scope='system'), GRANT hub_rw.
-- Viết tay, idempotent. Không FK sang admin.*. Hàm definer: chủ = role chạy migration, bảng không FORCE RLS ⇒ hàm
-- bỏ qua RLS ⇒ policy gọi hàm không đệ quy. `hub.rooms` KHÔNG có policy/GRANT INSERT: tạo phòng chỉ qua create_room (D3).
CREATE TABLE IF NOT EXISTS hub.rooms (
  id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  kind text NOT NULL,
  name text,
  dm_key text,
  last_seq bigint NOT NULL DEFAULT 0,
  last_activity_at timestamptz NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL,
  deleted_at timestamptz,
  CONSTRAINT rooms_pkey PRIMARY KEY (id),
  CONSTRAINT rooms_id_tenant_uq UNIQUE (id, tenant_id),
  CONSTRAINT rooms_kind_ck CHECK (kind IN ('dm', 'group')),
  CONSTRAINT rooms_shape_ck CHECK (
    (kind = 'dm' AND name IS NULL AND dm_key IS NOT NULL)
    OR (kind = 'group' AND dm_key IS NULL AND name IS NOT NULL AND char_length(name) BETWEEN 1 AND 80)),
  CONSTRAINT rooms_last_seq_ck CHECK (last_seq >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS rooms_dm_key_uq ON hub.rooms (tenant_id, dm_key) WHERE kind = 'dm';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS hub.room_members (
  room_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  user_id uuid NOT NULL,
  role text NOT NULL DEFAULT 'member',
  joined_at timestamptz NOT NULL,
  left_at timestamptz,
  hidden_at timestamptz,
  last_read_seq bigint NOT NULL DEFAULT 0,
  CONSTRAINT room_members_pkey PRIMARY KEY (room_id, user_id),
  CONSTRAINT room_members_room_fk FOREIGN KEY (room_id, tenant_id) REFERENCES hub.rooms (id, tenant_id),
  CONSTRAINT room_members_role_ck CHECK (role IN ('owner', 'member')),
  CONSTRAINT room_members_last_read_ck CHECK (last_read_seq >= 0),
  -- D9: đúng 1 owner hoạt động; deferrable để chuyển chủ bằng một câu UPDATE CASE.
  CONSTRAINT room_members_one_owner_ex EXCLUDE USING btree (room_id WITH =)
    WHERE (role = 'owner' AND left_at IS NULL) DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS room_members_user_active_idx ON hub.room_members (user_id)
  INCLUDE (room_id, last_read_seq, hidden_at) WHERE left_at IS NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS hub.room_messages (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  seq bigint NOT NULL,
  sender_type text NOT NULL,
  sender_id uuid,
  content text NOT NULL,
  client_msg_id uuid,
  run_id uuid,
  flow_id uuid,
  trigger_message_id uuid,
  created_at timestamptz NOT NULL,
  CONSTRAINT room_messages_pkey PRIMARY KEY (id),
  CONSTRAINT room_messages_room_fk FOREIGN KEY (room_id, tenant_id) REFERENCES hub.rooms (id, tenant_id),
  CONSTRAINT room_messages_seq_ck CHECK (seq >= 1),
  CONSTRAINT room_messages_sender_type_ck CHECK (sender_type IN ('user', 'agent')),
  CONSTRAINT room_messages_sender_ck CHECK (sender_type <> 'user' OR sender_id IS NOT NULL),
  CONSTRAINT room_messages_content_ck CHECK (char_length(content) BETWEEN 1 AND 16000),
  CONSTRAINT room_messages_seq_uq UNIQUE (room_id, seq)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS room_messages_client_uq ON hub.room_messages (room_id, sender_id, client_msg_id)
  WHERE client_msg_id IS NOT NULL;
--> statement-breakpoint

-- ── §4.2 Hàm SECURITY DEFINER (search_path cố định, tên bảng đủ schema) ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION hub.is_room_member(p_room uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
  AS $$
  SELECT current_setting('app.scope', true) = 'user' AND EXISTS (
    SELECT 1 FROM hub.room_members m
    WHERE m.room_id = p_room
      AND m.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
      AND m.tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
      AND m.left_at IS NULL)
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION hub.is_room_owner(p_room uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
  AS $$
  SELECT current_setting('app.scope', true) = 'user' AND EXISTS (
    SELECT 1 FROM hub.room_members m
    WHERE m.room_id = p_room
      AND m.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
      AND m.tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
      AND m.left_at IS NULL
      AND m.role = 'owner')
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION hub.is_tenant_user(p_user uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
  AS $$
  SELECT EXISTS (
    SELECT 1 FROM admin.users u
    WHERE u.id = p_user AND u.tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
$$;
--> statement-breakpoint
-- D3: tenant/user chỉ lấy từ GUC (không tham số). dm: dm_key tự tính, ON CONFLICT ⇒ trả phòng có sẵn (created=false).
CREATE OR REPLACE FUNCTION hub.create_room(p_id uuid, p_kind text, p_name text, p_peer uuid)
  RETURNS TABLE (room_id uuid, created boolean)
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
  AS $$
#variable_conflict use_column
DECLARE
  v_tid uuid := NULLIF(current_setting('app.tenant_id', true), '')::uuid;
  v_uid uuid := NULLIF(current_setting('app.user_id', true), '')::uuid;
  v_now timestamptz := date_trunc('milliseconds', now());
  v_key text;
  v_id uuid;
BEGIN
  IF current_setting('app.scope', true) IS DISTINCT FROM 'user' OR v_tid IS NULL OR v_uid IS NULL THEN
    RAISE EXCEPTION 'create_room: user scope required' USING ERRCODE = '42501';
  END IF;
  IF NOT hub.is_tenant_user(v_uid) THEN
    RAISE EXCEPTION 'create_room: caller not in tenant' USING ERRCODE = '42501';
  END IF;
  IF p_kind = 'group' THEN
    INSERT INTO hub.rooms (id, tenant_id, kind, name, dm_key, last_seq, last_activity_at, created_by, created_at)
      VALUES (p_id, v_tid, 'group', p_name, NULL, 0, v_now, v_uid, v_now);
    INSERT INTO hub.room_members (room_id, tenant_id, user_id, role, joined_at, last_read_seq)
      VALUES (p_id, v_tid, v_uid, 'owner', v_now, 0);
    RETURN QUERY SELECT p_id, true;
    RETURN;
  END IF;
  IF p_kind IS DISTINCT FROM 'dm' OR p_peer IS NULL OR p_peer = v_uid THEN
    RAISE EXCEPTION 'create_room: invalid kind or peer' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM admin.users u WHERE u.id = p_peer AND u.tenant_id = v_tid
                 AND u.active AND NOT u.locked_by_tenant) THEN
    RAISE EXCEPTION 'create_room: peer not found' USING ERRCODE = 'P0002';
  END IF;
  v_key := least(v_uid, p_peer)::text || ':' || greatest(v_uid, p_peer)::text;
  INSERT INTO hub.rooms (id, tenant_id, kind, name, dm_key, last_seq, last_activity_at, created_by, created_at)
    VALUES (p_id, v_tid, 'dm', NULL, v_key, 0, v_now, v_uid, v_now)
    ON CONFLICT (tenant_id, dm_key) WHERE kind = 'dm' DO NOTHING
    RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    SELECT r.id INTO v_id FROM hub.rooms r WHERE r.tenant_id = v_tid AND r.kind = 'dm' AND r.dm_key = v_key;
    RETURN QUERY SELECT v_id, false;
    RETURN;
  END IF;
  INSERT INTO hub.room_members (room_id, tenant_id, user_id, role, joined_at, last_read_seq)
    VALUES (v_id, v_tid, v_uid, 'member', v_now, 0), (v_id, v_tid, p_peer, 'member', v_now, 0);
  RETURN QUERY SELECT v_id, true;
END $$;
--> statement-breakpoint
-- D13: chưa đọc của từng thành viên hiện tại + tổng chưa đọc của họ (phòng đang hiện); rỗng nếu người gọi không là thành viên.
CREATE OR REPLACE FUNCTION hub.room_fanout(p_room uuid)
  RETURNS TABLE (user_id uuid, unread bigint, total bigint)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
  AS $$
  SELECT m.user_id,
    greatest(r.last_seq - m.last_read_seq, 0)::bigint,
    (SELECT coalesce(sum(greatest(r2.last_seq - m2.last_read_seq, 0)), 0)
       FROM hub.room_members m2 JOIN hub.rooms r2 ON r2.id = m2.room_id
       WHERE m2.user_id = m.user_id AND m2.left_at IS NULL AND m2.hidden_at IS NULL)::bigint
  FROM hub.room_members m JOIN hub.rooms r ON r.id = m.room_id
  WHERE m.room_id = p_room AND m.left_at IS NULL AND hub.is_room_member(p_room)
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION hub.is_room_member(uuid), hub.is_room_owner(uuid), hub.is_tenant_user(uuid),
  hub.create_room(uuid, text, text, uuid), hub.room_fanout(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION hub.is_room_member(uuid), hub.is_room_owner(uuid), hub.is_tenant_user(uuid),
  hub.create_room(uuid, text, text, uuid), hub.room_fanout(uuid) TO hub_rw;
--> statement-breakpoint

-- ── §4.3 RLS (policy chỉ TO hub_rw; U = scope 'user' + đúng tenant GUC) ──────────────────────────────────────────────
ALTER TABLE hub.rooms ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE hub.room_members ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE hub.room_messages ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'hub' AND tablename = 'rooms'
                 AND policyname = 'rooms_member_select') THEN
    CREATE POLICY rooms_member_select ON hub.rooms FOR SELECT TO hub_rw
      USING (current_setting('app.scope', true) = 'user'
             AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
             AND hub.is_room_member(id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'hub' AND tablename = 'rooms'
                 AND policyname = 'rooms_member_update') THEN
    CREATE POLICY rooms_member_update ON hub.rooms FOR UPDATE TO hub_rw
      USING (current_setting('app.scope', true) = 'user'
             AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
             AND hub.is_room_member(id))
      WITH CHECK (current_setting('app.scope', true) = 'user'
             AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'hub' AND tablename = 'room_members'
                 AND policyname = 'room_members_select') THEN
    CREATE POLICY room_members_select ON hub.room_members FOR SELECT TO hub_rw
      USING (current_setting('app.scope', true) = 'user'
             AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
             AND hub.is_room_member(room_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'hub' AND tablename = 'room_members'
                 AND policyname = 'room_members_insert') THEN
    CREATE POLICY room_members_insert ON hub.room_members FOR INSERT TO hub_rw
      WITH CHECK (current_setting('app.scope', true) = 'user'
             AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
             AND role = 'member' AND hub.is_room_owner(room_id) AND hub.is_tenant_user(user_id));
  END IF;
  -- USING không đòi owner: gửi tin DM phải bỏ ẩn hàng của peer. WITH CHECK chặn tự nâng thành owner.
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'hub' AND tablename = 'room_members'
                 AND policyname = 'room_members_update') THEN
    CREATE POLICY room_members_update ON hub.room_members FOR UPDATE TO hub_rw
      USING (current_setting('app.scope', true) = 'user'
             AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
             AND hub.is_room_member(room_id))
      WITH CHECK (current_setting('app.scope', true) = 'user'
             AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
             AND (role = 'member' OR hub.is_room_owner(room_id)));
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'hub' AND tablename = 'room_messages'
                 AND policyname = 'room_messages_select') THEN
    CREATE POLICY room_messages_select ON hub.room_messages FOR SELECT TO hub_rw
      USING (current_setting('app.scope', true) = 'user'
             AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
             AND hub.is_room_member(room_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'hub' AND tablename = 'room_messages'
                 AND policyname = 'room_messages_insert') THEN
    CREATE POLICY room_messages_insert ON hub.room_messages FOR INSERT TO hub_rw
      WITH CHECK (current_setting('app.scope', true) = 'user'
             AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
             AND sender_type = 'user'
             AND sender_id = NULLIF(current_setting('app.user_id', true), '')::uuid
             AND hub.is_room_member(room_id));
  END IF;
END $$;
--> statement-breakpoint

-- ── §4.4 GRANT hub_rw (hub_api thừa hưởng). Không DELETE/TRUNCATE; room_messages không UPDATE ─────────────────────────
GRANT SELECT, UPDATE (name, last_seq, last_activity_at, deleted_at) ON hub.rooms TO hub_rw;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE (role, joined_at, left_at, hidden_at, last_read_seq) ON hub.room_members TO hub_rw;
--> statement-breakpoint
GRANT SELECT, INSERT ON hub.room_messages TO hub_rw;

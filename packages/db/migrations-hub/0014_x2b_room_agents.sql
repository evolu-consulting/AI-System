-- HUB-FR-101 · HUB-BR-21 · HUB-BR-22 · X2b (plan §1 D1, D4, D12, D14; §4.1, §4.2; §5): agent trong phòng chat.
-- Không sửa 0011–0013; viết tay, idempotent (ADD COLUMN IF NOT EXISTS / kiểm pg_constraint / CREATE OR REPLACE / ALTER POLICY).
-- (1) Cột: `flows.room_flow_id` (thread; người mở: = id), `conversations.room_id` (hội thoại nền ẩn, ≤ 1/phòng/user),
--     `runs.room_id` + `room_posted_at` (đăng tin agent idempotent, D4), `room_messages` + 6 cột (placement, meta run).
-- (2) CHECK `room_messages_user_no_agent_ck` (0013) thay bằng `_user_ck` (cho phép `flow_id`: tin người↔người trong thread),
--     `_agent_ck`, `_flow_ck`, `_ask_ck`. FK `flow_id → flows`, `run_id → runs`, `trigger_message_id → room_messages`
--     (dữ liệu X2a đều NULL). RV2-N2c giữ: id ngẫu nhiên ⇒ FK/policy từ chối.
-- (3) Policy INSERT tin: thêm `flow_id IS NULL OR hub.is_room_thread(room_id, flow_id)` — KHÔNG đòi quyền agent (BR-21:
--     mọi thành viên nhắn vào thread). Không thêm policy UPDATE nào (giả định của `room_members_guard`, 0013 N4b).
-- (4) Definer: `is_room_thread` (user), `room_post_agent_message` + `room_fanout_sys` (chỉ system), `room_run_states`
--     (user + thành viên). Tenant/user chỉ lấy từ GUC hoặc từ hàng `runs` (không nhận user_id/tenant_id tham số).
-- Thứ tự khoá definer đăng tin: rooms → runs → room_members → room_messages (plan §5, không chu trình với đường gọi).
ALTER TABLE hub.flows ADD COLUMN IF NOT EXISTS room_flow_id uuid;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS flows_room_user_uq ON hub.flows (room_flow_id, user_id) WHERE room_flow_id IS NOT NULL;
--> statement-breakpoint
ALTER TABLE hub.conversations ADD COLUMN IF NOT EXISTS room_id uuid;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS conversations_room_user_uq ON hub.conversations (room_id, user_id)
  WHERE room_id IS NOT NULL;
--> statement-breakpoint
ALTER TABLE hub.runs ADD COLUMN IF NOT EXISTS room_id uuid;
--> statement-breakpoint
ALTER TABLE hub.runs ADD COLUMN IF NOT EXISTS room_posted_at timestamptz;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS runs_room_running_idx ON hub.runs (room_id) WHERE room_id IS NOT NULL AND status = 'running';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS runs_room_unposted_idx ON hub.runs (finished_at)
  WHERE room_id IS NOT NULL AND room_posted_at IS NULL AND status <> 'running';
--> statement-breakpoint
ALTER TABLE hub.room_messages ADD COLUMN IF NOT EXISTS placement text NOT NULL DEFAULT 'main';
--> statement-breakpoint
ALTER TABLE hub.room_messages ADD COLUMN IF NOT EXISTS run_status text;
--> statement-breakpoint
ALTER TABLE hub.room_messages ADD COLUMN IF NOT EXISTS wait_kind text;
--> statement-breakpoint
ALTER TABLE hub.room_messages ADD COLUMN IF NOT EXISTS ask jsonb;
--> statement-breakpoint
ALTER TABLE hub.room_messages ADD COLUMN IF NOT EXISTS step_count integer;
--> statement-breakpoint
ALTER TABLE hub.room_messages ADD COLUMN IF NOT EXISTS run_ms integer;
--> statement-breakpoint
ALTER TABLE hub.room_messages DROP CONSTRAINT IF EXISTS room_messages_user_no_agent_ck;
--> statement-breakpoint
DO $$
DECLARE
  v_ck text[][] := ARRAY[
    ['hub.conversations', 'conversations_room_fk',
     'FOREIGN KEY (room_id, tenant_id) REFERENCES hub.rooms (id, tenant_id)'],
    ['hub.runs', 'runs_room_fk', 'FOREIGN KEY (room_id, tenant_id) REFERENCES hub.rooms (id, tenant_id)'],
    ['hub.runs', 'runs_room_posted_ck',
     'CHECK (room_posted_at IS NULL OR (room_id IS NOT NULL AND status <> ''running''))'],
    ['hub.room_messages', 'room_messages_placement_ck', 'CHECK (placement IN (''main'', ''flow''))'],
    ['hub.room_messages', 'room_messages_run_status_ck',
     'CHECK (run_status IS NULL OR run_status IN (''finished'', ''failed'', ''cancelled''))'],
    ['hub.room_messages', 'room_messages_wait_kind_ck',
     'CHECK (wait_kind IS NULL OR wait_kind IN (''need_input'', ''side_effect''))'],
    ['hub.room_messages', 'room_messages_step_count_ck', 'CHECK (step_count IS NULL OR step_count >= 0)'],
    ['hub.room_messages', 'room_messages_run_ms_ck', 'CHECK (run_ms IS NULL OR run_ms >= 0)'],
    ['hub.room_messages', 'room_messages_user_ck',
     'CHECK (sender_type <> ''user'' OR (run_id IS NULL AND trigger_message_id IS NULL AND run_status IS NULL'
       || ' AND wait_kind IS NULL AND ask IS NULL AND step_count IS NULL AND run_ms IS NULL))'],
    ['hub.room_messages', 'room_messages_agent_ck',
     'CHECK (sender_type <> ''agent'' OR (sender_id IS NOT NULL AND run_id IS NOT NULL AND flow_id IS NOT NULL'
       || ' AND trigger_message_id IS NOT NULL AND run_status IS NOT NULL))'],
    ['hub.room_messages', 'room_messages_flow_ck', 'CHECK (placement = ''main'' OR flow_id IS NOT NULL)'],
    ['hub.room_messages', 'room_messages_ask_ck', 'CHECK (ask IS NULL OR wait_kind = ''need_input'')'],
    ['hub.room_messages', 'room_messages_flow_fk', 'FOREIGN KEY (flow_id) REFERENCES hub.flows (id)'],
    ['hub.room_messages', 'room_messages_run_fk', 'FOREIGN KEY (run_id) REFERENCES hub.runs (id)'],
    ['hub.room_messages', 'room_messages_trigger_fk',
     'FOREIGN KEY (trigger_message_id) REFERENCES hub.room_messages (id)']];
  i int;
BEGIN
  FOR i IN 1 .. array_length(v_ck, 1) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = v_ck[i][2]
                   AND conrelid = v_ck[i][1]::regclass) THEN
      EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I %s', v_ck[i][1], v_ck[i][2], v_ck[i][3]);
    END IF;
  END LOOP;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS room_messages_run_uq ON hub.room_messages (run_id) WHERE sender_type = 'agent';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS room_messages_main_idx ON hub.room_messages (room_id, seq) WHERE placement = 'main';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS room_messages_flow_idx ON hub.room_messages (room_id, flow_id, seq)
  WHERE flow_id IS NOT NULL;
--> statement-breakpoint

-- ── §4.2 Hàm SECURITY DEFINER (search_path cố định, tên bảng đủ schema) ─────────────────────────────────────────────
-- `p_flow` là thread của `p_room` (người gọi = thành viên hiện tại, cùng tenant GUC): (i) đã có tin gốc `placement='main'`
-- mang `flow_id = p_flow`, hoặc (ii) flow nền của chính người gọi trong phòng có `room_flow_id = id` (người mở, cùng tx,
-- trước khi tin gốc tồn tại). Definer để policy INSERT không đệ quy RLS; không nhận user_id tham số.
CREATE OR REPLACE FUNCTION hub.is_room_thread(p_room uuid, p_flow uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
  AS $$
  SELECT current_setting('app.scope', true) = 'user' AND hub.is_room_member(p_room) AND (
    EXISTS (
      SELECT 1 FROM hub.room_messages m
      WHERE m.room_id = p_room AND m.flow_id = p_flow AND m.placement = 'main'
        AND m.tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    OR EXISTS (
      SELECT 1 FROM hub.flows f JOIN hub.conversations c ON c.id = f.conversation_id
      WHERE f.id = p_flow AND f.room_flow_id = f.id AND c.room_id = p_room
        AND f.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
        AND c.user_id = f.user_id
        AND f.tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
        AND c.tenant_id = f.tenant_id))
$$;
--> statement-breakpoint
-- D4/D12/D14 (tx2, scope system): đăng tin agent của run phòng. Idempotent theo `runs.room_posted_at` (+ unique tin agent
-- theo run). `reason`: 'posted' (đăng), 'already' (đã đăng / run còn chạy), 'skipped' (R17: phòng xoá / người gọi rời).
-- `p_meta` jsonb: {run_status?, wait_kind?, ask?, step_count?, run_ms?} — CHECK bảng chặn giá trị sai.
CREATE OR REPLACE FUNCTION hub.room_post_agent_message(p_run uuid, p_sender uuid, p_content text, p_meta jsonb)
  RETURNS TABLE (posted boolean, reason text, seq bigint, created_at timestamptz, placement text)
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
  AS $$
#variable_conflict use_column
DECLARE
  v_room uuid;
  v_run record;
  v_rm record;
  v_thread uuid;
  v_place text;
  v_seq bigint;
  v_at timestamptz;
  v_kind text;
BEGIN
  IF current_setting('app.scope', true) IS DISTINCT FROM 'system' THEN
    RAISE EXCEPTION 'room_post_agent_message: system scope required' USING ERRCODE = '42501';
  END IF;
  SELECT r.room_id INTO v_room FROM hub.runs r WHERE r.id = p_run;
  IF v_room IS NULL THEN
    RAISE EXCEPTION 'room_post_agent_message: not a room run' USING ERRCODE = 'P0002';
  END IF;
  SELECT r.id, r.deleted_at INTO v_rm FROM hub.rooms r WHERE r.id = v_room FOR UPDATE;
  SELECT r.* INTO v_run FROM hub.runs r WHERE r.id = p_run FOR UPDATE;
  IF v_run.room_posted_at IS NOT NULL OR v_run.status = 'running' THEN
    RETURN QUERY SELECT false, 'already'::text, NULL::bigint, NULL::timestamptz, NULL::text;
    RETURN;
  END IF;
  IF v_rm.deleted_at IS NOT NULL OR NOT EXISTS (
       SELECT 1 FROM hub.room_members m
       WHERE m.room_id = v_room AND m.user_id = v_run.user_id AND m.tenant_id = v_run.tenant_id AND m.left_at IS NULL) THEN
    UPDATE hub.runs r SET room_posted_at = now() WHERE r.id = p_run;
    RETURN QUERY SELECT false, 'skipped'::text, NULL::bigint, NULL::timestamptz, NULL::text;
    RETURN;
  END IF;
  SELECT f.room_flow_id INTO v_thread FROM hub.flows f WHERE f.id = v_run.flow_id AND f.tenant_id = v_run.tenant_id;
  SELECT m.placement INTO v_place FROM hub.room_messages m
    WHERE m.id = v_run.user_message_id AND m.room_id = v_room;
  IF v_thread IS NULL OR v_place IS NULL THEN
    RAISE EXCEPTION 'room_post_agent_message: run has no room thread/trigger' USING ERRCODE = '22023';
  END IF;
  UPDATE hub.rooms r SET last_seq = r.last_seq + 1,
      last_activity_at = date_trunc('milliseconds', clock_timestamp())
    WHERE r.id = v_room
    RETURNING r.last_seq, r.last_activity_at, r.kind INTO v_seq, v_at, v_kind;
  IF v_kind = 'dm' THEN
    UPDATE hub.room_members m SET hidden_at = NULL
      WHERE m.room_id = v_room AND m.left_at IS NULL AND m.hidden_at IS NOT NULL;
  END IF;
  INSERT INTO hub.room_messages (id, room_id, tenant_id, seq, sender_type, sender_id, content, run_id, flow_id,
      trigger_message_id, created_at, placement, run_status, wait_kind, ask, step_count, run_ms)
    VALUES (v_run.answer_message_id, v_room, v_run.tenant_id, v_seq, 'agent', p_sender, p_content, p_run, v_thread,
      v_run.user_message_id, v_at, v_place, coalesce(p_meta ->> 'run_status', v_run.status), p_meta ->> 'wait_kind',
      CASE WHEN jsonb_typeof(p_meta -> 'ask') = 'object' THEN p_meta -> 'ask' END,
      (p_meta ->> 'step_count')::integer, (p_meta ->> 'run_ms')::integer);
  -- D14: mốc đọc người gọi lên `seq` chỉ khi họ đã đọc hết trước tin này.
  UPDATE hub.room_members m SET last_read_seq = v_seq
    WHERE m.room_id = v_room AND m.user_id = v_run.user_id AND m.left_at IS NULL AND m.last_read_seq = v_seq - 1;
  UPDATE hub.runs r SET room_posted_at = now() WHERE r.id = p_run;
  RETURN QUERY SELECT true, 'posted'::text, v_seq, v_at, v_place;
END $$;
--> statement-breakpoint
-- Như `room_fanout` (0012) cho mọi thành viên hiện tại, dùng sau khi tx2 (system) đăng tin agent. Chỉ scope system.
CREATE OR REPLACE FUNCTION hub.room_fanout_sys(p_room uuid)
  RETURNS TABLE (user_id uuid, unread bigint, total bigint)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
  AS $$
BEGIN
  IF current_setting('app.scope', true) IS DISTINCT FROM 'system' THEN
    RAISE EXCEPTION 'room_fanout_sys: system scope required' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT m.user_id,
    greatest(r.last_seq - m.last_read_seq, 0)::bigint,
    (SELECT coalesce(sum(greatest(r2.last_seq - m2.last_read_seq, 0)), 0)
       FROM hub.room_members m2 JOIN hub.rooms r2 ON r2.id = m2.room_id
       WHERE m2.user_id = m.user_id AND m2.tenant_id = m.tenant_id
         AND m2.left_at IS NULL AND m2.hidden_at IS NULL)::bigint
  FROM hub.rooms r JOIN hub.room_members m ON m.room_id = r.id AND m.tenant_id = r.tenant_id
  WHERE r.id = p_room AND m.left_at IS NULL;
END $$;
--> statement-breakpoint
-- Lượt đang chạy/đang chờ của phòng (GET /rooms/:id `active_runs`). Scope user + thành viên hiện tại + tenant GUC.
-- (a) run phòng `running`; (b) tin agent có `wait_kind` mà flow nền của run đó chưa có run mới hơn, người gọi còn ở phòng.
-- `flow_id` = thread (`flows.room_flow_id`). Không trả nội dung/tham số (R12).
CREATE OR REPLACE FUNCTION hub.room_run_states(p_room uuid)
  RETURNS TABLE (run_id uuid, flow_id uuid, trigger_message_id uuid, caller_id uuid, agent_id uuid, status text,
                 wait_kind text, started_at timestamptz)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
  AS $$
  WITH g AS (
    SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid AS tid
    WHERE current_setting('app.scope', true) = 'user' AND hub.is_room_member(p_room)),
  s AS (
    SELECT r.id, f.room_flow_id, r.user_message_id, r.user_id, r.agent_id, 'running'::text AS st, NULL::text AS wk,
      r.started_at
    FROM g JOIN hub.runs r ON r.room_id = p_room AND r.tenant_id = g.tid AND r.status = 'running'
    JOIN hub.flows f ON f.id = r.flow_id
    UNION ALL
    SELECT r.id, m.flow_id, r.user_message_id, r.user_id, r.agent_id, 'waiting'::text, m.wait_kind, r.started_at
    FROM g JOIN hub.room_messages m ON m.room_id = p_room AND m.tenant_id = g.tid AND m.sender_type = 'agent'
      AND m.wait_kind IS NOT NULL
    JOIN hub.runs r ON r.id = m.run_id
    WHERE NOT EXISTS (SELECT 1 FROM hub.runs n WHERE n.flow_id = r.flow_id AND n.id <> r.id
                        AND n.started_at > r.started_at)
      AND EXISTS (SELECT 1 FROM hub.room_members x WHERE x.room_id = p_room AND x.user_id = r.user_id
                    AND x.left_at IS NULL))
  SELECT * FROM s ORDER BY 8, 1 LIMIT 50
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION hub.is_room_thread(uuid, uuid), hub.room_post_agent_message(uuid, uuid, text, jsonb),
  hub.room_fanout_sys(uuid), hub.room_run_states(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION hub.is_room_thread(uuid, uuid), hub.room_post_agent_message(uuid, uuid, text, jsonb),
  hub.room_fanout_sys(uuid), hub.room_run_states(uuid) TO hub_rw;
--> statement-breakpoint
ALTER POLICY room_messages_insert ON hub.room_messages
  WITH CHECK (current_setting('app.scope', true) = 'user'
         AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         AND sender_type = 'user'
         AND sender_id = NULLIF(current_setting('app.user_id', true), '')::uuid
         AND hub.is_room_member(room_id)
         AND seq = hub.room_last_seq(room_id)
         AND (flow_id IS NULL OR hub.is_room_thread(room_id, flow_id)));

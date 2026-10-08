-- HUB-FR-101 · HUB-BR-22 · X2b-R17 · X2b review-security-1 #1, #2, #3, #6 (test khoá `security-rv1.int`). Không sửa 0014.
-- (1) `hub.runs`: `hub_rw` chỉ UPDATE các cột vòng đời run (kết thúc/huỷ/lease/seq/file) + `room_id` (`setRunRoom`).
--     Bỏ UPDATE `flow_id`, `answer_message_id`, `user_message_id`, `agent_id`, `conversation_id`, `room_posted_at`… —
--     chủ run không sửa được ở scope user (lưới thứ nhất; INSERT vẫn có ⇒ definer không tin cột, xem (2)).
-- (2) `room_post_agent_message`: giữ chữ ký 0014 (instance cũ khi deploy cuốn chiếu, ACL giữ nguyên) nhưng **bỏ qua**
--     `p_sender` (#6) — sender suy từ run/flow như `runOutcome`.
--     Mọi chỗ đăng suy từ dữ liệu đối chiếu được, không tin cột `runs` đơn lẻ (#1): flow nền thuộc hội thoại nền của
--     (phòng, `runs.user_id`); tin gọi là tin user của `runs.user_id` trong phòng mang `flow_id` = thread; tin trả lời là
--     tin assistant của chính run (`run_id`, `user_id`, `flow_id`). Lệch ⇒ `skipped` + `room_posted_at` (không lặp vòng bù).
-- (3) `room_run_states`: nhánh `running` chỉ run của thành viên hiện tại có flow nền thuộc hội thoại nền của phòng (#2);
--     cả hai nhánh chỉ run bắt đầu từ lần vào phòng hiện tại (`started_at >= joined_at`) ⇒ rời/bớt rồi thêm lại không
--     còn lượt chờ cũ (#3, R17/Q8).
REVOKE UPDATE ON hub.runs FROM hub_rw;
--> statement-breakpoint
GRANT UPDATE (status, last_seq, error_code, error_message, error_hint, owner, lease_until, finished_at, attachment_ids,
  room_id) ON hub.runs TO hub_rw;
--> statement-breakpoint
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
  v_flow_agent uuid;
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
  -- Flow nền của người gọi trong hội thoại nền của đúng phòng ⇒ thread.
  SELECT f.room_flow_id, f.agent_id INTO v_thread, v_flow_agent
    FROM hub.flows f JOIN hub.conversations c ON c.id = f.conversation_id
    WHERE f.id = v_run.flow_id AND f.tenant_id = v_run.tenant_id AND f.user_id = v_run.user_id
      AND c.room_id = v_room AND c.user_id = v_run.user_id AND c.tenant_id = v_run.tenant_id;
  -- Tin gọi: tin user của người gọi trong phòng, thuộc thread đó.
  SELECT m.placement INTO v_place FROM hub.room_messages m
    WHERE m.id = v_run.user_message_id AND m.room_id = v_room AND m.tenant_id = v_run.tenant_id
      AND m.sender_type = 'user' AND m.sender_id = v_run.user_id AND m.flow_id = v_thread;
  IF v_rm.deleted_at IS NOT NULL OR v_thread IS NULL OR v_place IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM hub.room_members m
       WHERE m.room_id = v_room AND m.user_id = v_run.user_id AND m.tenant_id = v_run.tenant_id AND m.left_at IS NULL)
     OR NOT EXISTS (
       SELECT 1 FROM hub.messages pm
       WHERE pm.id = v_run.answer_message_id AND pm.run_id = p_run AND pm.tenant_id = v_run.tenant_id
         AND pm.user_id = v_run.user_id AND pm.flow_id = v_run.flow_id AND pm.role = 'assistant') THEN
    UPDATE hub.runs r SET room_posted_at = now() WHERE r.id = p_run;
    RETURN QUERY SELECT false, 'skipped'::text, NULL::bigint, NULL::timestamptz, NULL::text;
    RETURN;
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
    VALUES (v_run.answer_message_id, v_room, v_run.tenant_id, v_seq, 'agent',
      coalesce(v_run.agent_id, v_flow_agent, v_run.orchestrator_tenant_id, v_run.tenant_id), p_content, p_run, v_thread,
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
    JOIN hub.flows f ON f.id = r.flow_id AND f.user_id = r.user_id AND f.tenant_id = r.tenant_id
    JOIN hub.conversations c ON c.id = f.conversation_id AND c.room_id = p_room AND c.user_id = r.user_id
    WHERE f.room_flow_id IS NOT NULL
      AND EXISTS (SELECT 1 FROM hub.room_members x WHERE x.room_id = p_room AND x.user_id = r.user_id
                    AND x.left_at IS NULL AND r.started_at >= x.joined_at)
    UNION ALL
    SELECT r.id, m.flow_id, r.user_message_id, r.user_id, r.agent_id, 'waiting'::text, m.wait_kind, r.started_at
    FROM g JOIN hub.room_messages m ON m.room_id = p_room AND m.tenant_id = g.tid AND m.sender_type = 'agent'
      AND m.wait_kind IS NOT NULL
    JOIN hub.runs r ON r.id = m.run_id
    WHERE NOT EXISTS (SELECT 1 FROM hub.runs n WHERE n.flow_id = r.flow_id AND n.id <> r.id
                        AND n.started_at > r.started_at)
      AND EXISTS (SELECT 1 FROM hub.room_members x WHERE x.room_id = p_room AND x.user_id = r.user_id
                    AND x.left_at IS NULL AND r.started_at >= x.joined_at))
  SELECT * FROM s ORDER BY 8, 1 LIMIT 50
$$;

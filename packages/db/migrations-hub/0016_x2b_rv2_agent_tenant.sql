-- HUB-FR-101 · HUB-BR-22 · X2b review-security-2 M1 (lưới, giả danh agent). Không sửa 0014/0015.
-- `room_post_agent_message`: agent đứng tên tin (`coalesce(runs.agent_id, flows.agent_id)`, nếu có) phải được cấp cho
-- đúng tenant của run (`hub.agent_entitlements`, `hub.agents` không có `tenant_id`); lệch ⇒ `skipped` + `room_posted_at`.
-- Thân hàm còn lại giữ nguyên 0015. Phần REVOKE INSERT `hub.runs` / tin `assistant` khỏi scope user: TECH-DEBT.
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
     OR (coalesce(v_run.agent_id, v_flow_agent) IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM hub.agent_entitlements e JOIN hub.agents a ON a.id = e.agent_id
       WHERE e.agent_id = coalesce(v_run.agent_id, v_flow_agent) AND e.tenant_id = v_run.tenant_id))
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

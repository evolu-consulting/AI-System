-- HUB-FR-113 · P-a PF1 RV2 Major #1 · plan-contract §5: người nhận `process.updated` = người bắt đầu + thành viên đang
-- hoạt động của phòng nguồn + assignee (user + thành viên group) các task **open**. `core.repo.runRecipients` chạy dưới
-- scope người làm (`user`) khi gates review/decide/cancel + launcher `lostPermission`, hoặc nền (`system`) khi stage
-- driver/launcher kick. Policy `room_members_select` (0011) đòi caller là thành viên phòng (scope='user') ⇒ người quyết
-- định ngoài phòng (review-group) hay người bắt đầu đã rời phòng ⇒ nhánh `room_members` trả 0 dòng, rơi mất thành viên
-- phòng (vi phạm contract, không rò dữ liệu). Hàm definer dưới đây gom người nhận bỏ qua RLS, cách ly chặt theo tenant
-- của run — mirror `hub.process_run_viewer` (0019): search_path cố định, tên bảng đủ schema, tenant từ GUC, GRANT hub_rw.
-- Additive: chỉ thêm 1 hàm; không đổi bảng/cột. Idempotent (CREATE OR REPLACE / GRANT / REVOKE).

CREATE OR REPLACE FUNCTION hub.process_run_recipients(p_run uuid, p_tenant uuid) RETURNS TABLE (uid uuid)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  v_scope text := current_setting('app.scope', true);
  v_guc   uuid := NULLIF(current_setting('app.tenant_id', true), '')::uuid;
  v_tid   uuid;
  v_started uuid;
  v_kind  text;
  v_room  uuid;
BEGIN
  -- Tenant/nguồn của run (definer bỏ RLS). Không thấy run ⇒ không trả gì.
  SELECT pr.tenant_id, pr.started_by, pr.origin_kind, pr.origin_room_id
    INTO v_tid, v_started, v_kind, v_room
    FROM hub.process_runs pr WHERE pr.id = p_run;
  IF v_tid IS NULL OR v_tid IS DISTINCT FROM p_tenant THEN
    RETURN;
  END IF;
  -- Cách ly tenant: scope 'user' phải khớp GUC tenant (không cho mạo danh tenant khác). 'system' = việc nền tin cậy, gom
  -- theo tenant của run (đã khớp p_tenant ở trên). Scope khác / không scope ⇒ không trả gì.
  IF v_scope = 'user' THEN
    IF v_guc IS NULL OR v_guc IS DISTINCT FROM v_tid THEN
      RETURN;
    END IF;
  ELSIF v_scope IS DISTINCT FROM 'system' THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT v_started WHERE v_started IS NOT NULL
    UNION
    SELECT m.user_id FROM hub.room_members m
      WHERE v_kind = 'room' AND v_room IS NOT NULL
        AND m.room_id = v_room AND m.tenant_id = v_tid AND m.left_at IS NULL
    UNION
    SELECT a.user_id FROM hub.review_task_assignees a
      JOIN hub.review_tasks t ON t.id = a.task_id AND t.tenant_id = a.tenant_id
      WHERE t.process_run_id = p_run AND t.tenant_id = v_tid AND t.status = 'open' AND a.user_id IS NOT NULL
    UNION
    SELECT gm.user_id FROM hub.review_tasks t
      JOIN admin.group_members gm ON gm.group_id = t.assignee_group_id AND gm.tenant_id = v_tid
      WHERE t.process_run_id = p_run AND t.tenant_id = v_tid AND t.status = 'open'
        AND t.assignee_group_id IS NOT NULL;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION hub.process_run_recipients(uuid, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION hub.process_run_recipients(uuid, uuid) TO hub_rw;

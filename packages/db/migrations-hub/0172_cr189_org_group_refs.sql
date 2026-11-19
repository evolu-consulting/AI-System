-- CR-189 · lát cr189-admin-org-api · sửa cơ cấu trên sơ đồ: Group của phòng ban còn được Hub dùng ở đâu?
-- `admin_rw` không đọc bảng quy trình/việc duyệt (RLS hub_rw) ⇒ MỘT hàm DEFINER trả tham chiếu theo lô nhóm (chỉ id, không nội dung):
--   agent    = `hub.agent_grants` (subject_type = 'group');  process = `hub.process_defs.run_group_ids`;
--   review_open = việc duyệt ĐANG MỞ giao cho nhóm (`review_tasks.assignee_group_id` hoặc `review_task_assignees.group_id`);
--   review_any  = nhóm từng được giao việc duyệt (đã đóng cũng tính; một hàng/nhóm, item_id NULL).
-- Chỉ quản trị đúng công ty (scope platform, hoặc `app.tenant_id` = p_tenant) — khác ⇒ 42501. Tham số nhóm ≤ 1000.
CREATE OR REPLACE FUNCTION hub.org_group_refs(p_tenant uuid, p_groups uuid[])
RETURNS TABLE (group_id uuid, kind text, item_id uuid)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF coalesce(current_setting('app.scope', true), '') <> 'platform'
     AND NULLIF(current_setting('app.tenant_id', true), '')::uuid IS DISTINCT FROM p_tenant THEN
    RAISE EXCEPTION 'org_group_refs: không đúng công ty' USING ERRCODE = '42501';
  END IF;
  IF cardinality(p_groups) > 1000 THEN
    RAISE EXCEPTION 'org_group_refs: quá 1000 nhóm' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  SELECT a.subject_id, 'agent'::text, a.agent_id FROM hub.agent_grants a
   WHERE a.tenant_id = p_tenant AND a.subject_type = 'group' AND a.subject_id = ANY (p_groups)
  UNION ALL
  SELECT g, 'process'::text, d.id FROM hub.process_defs d, unnest(p_groups) g
   WHERE d.tenant_id = p_tenant AND g = ANY (d.run_group_ids)
  UNION ALL
  SELECT t.assignee_group_id, 'review_open'::text, t.id FROM hub.review_tasks t
   WHERE t.tenant_id = p_tenant AND t.status = 'open' AND t.assignee_group_id = ANY (p_groups)
  UNION ALL
  SELECT x.group_id, 'review_open'::text, t.id FROM hub.review_task_assignees x
    JOIN hub.review_tasks t ON t.id = x.task_id AND t.tenant_id = x.tenant_id
   WHERE x.tenant_id = p_tenant AND t.status = 'open' AND x.group_id = ANY (p_groups)
  UNION ALL
  SELECT g, 'review_any'::text, NULL::uuid FROM unnest(p_groups) g
   WHERE EXISTS (SELECT 1 FROM hub.review_tasks t WHERE t.tenant_id = p_tenant AND t.assignee_group_id = g)
      OR EXISTS (SELECT 1 FROM hub.review_task_assignees x WHERE x.tenant_id = p_tenant AND x.group_id = g);
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION hub.org_group_refs(uuid, uuid[]) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION hub.org_group_refs(uuid, uuid[]) TO admin_rw;

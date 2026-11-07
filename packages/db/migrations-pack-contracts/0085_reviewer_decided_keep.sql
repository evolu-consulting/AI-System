-- CR-122 p21c · người ĐÃ quyết một bước duyệt (Đạt / Trả lại / Từ chối — `hub.review_tasks.decided_by` = tôi, kind `review`) của
-- bất kỳ lượt nào (đang chạy hay đã xong, MỌI thời điểm) của HĐ GIỮ quyền ĐỌC HĐ đó — thay giới hạn 90 ngày của 0070 (b1) và gộp
-- nhánh "run đang chạy mình đã quyết" (b2, nay thừa). Nhánh (a) người duyệt của bước đang mở giữ nguyên văn 0070. Vẫn chỉ ĐỌC (policy
-- UPDATE như 0070: nhánh người duyệt chỉ khi cờ `app.approval_write`), theo `app.tenant_id`/`app.user_id`. Hiệu năng (Luật 4c): nhánh
-- đã quyết vào qua index một phần `review_tasks_decided_by_idx (decided_by, tenant_id, decided_at)` (0070) theo khoá (decided_by,
-- tenant_id) → PK `process_runs`; số hàng = số bước chính người đó đã quyết, không phụ thuộc cỡ bảng. Một mảng mỗi câu (InitPlan).
-- Policy SELECT `contracts_visible` (0083) gọi hàm theo tên ⇒ không đổi. Chỉ thay hàm; chạy lại vô hại.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
CREATE OR REPLACE FUNCTION contracts.reviewer_contract_ids() RETURNS uuid[]
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  WITH me AS (SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid AS t,
                     NULLIF(current_setting('app.user_id', true), '')::uuid AS u),
  g AS (SELECT coalesce(array_agg(gm.group_id), '{}'::uuid[]) AS ids
        FROM me JOIN admin.group_members gm ON gm.user_id = me.u AND gm.tenant_id = me.t)
  SELECT coalesce(array_agg(DISTINCT x.id), '{}'::uuid[]) FROM me CROSS JOIN g CROSS JOIN LATERAL (
    SELECT r.pack_record_id AS id
    FROM hub.process_runs r
    JOIN hub.review_tasks t ON t.process_run_id = r.id AND t.tenant_id = r.tenant_id
      AND t.kind = 'review' AND t.status = 'open'
    JOIN hub.stage_runs s ON s.id = t.stage_run_id AND s.tenant_id = t.tenant_id
    CROSS JOIN LATERAL (SELECT r.snapshot -> 'stages' -> (s.stage_idx::int) AS st OFFSET 0) xs
    CROSS JOIN LATERAL (SELECT coalesce(
        (SELECT au.id FROM admin.users au
          WHERE (xs.st -> 'after' ->> 'kind') = 'review'
            AND au.id = nullif(xs.st -> 'after' ->> 'approver_user_id', '')::uuid
            AND au.tenant_id = t.tenant_id AND au.active AND NOT au.locked_by_tenant),
        (SELECT d.head_user_id FROM admin.departments d
          WHERE (xs.st -> 'after' ->> 'kind') = 'review' AND (xs.st -> 'after' ->> 'head_only') = 'true'
            AND d.group_id = nullif(xs.st -> 'after' ->> 'group_id', '')::uuid AND d.tenant_id = t.tenant_id)) AS gate) hg
    WHERE r.tenant_id = me.t AND r.pack_key = 'contracts' AND r.pack_record_id IS NOT NULL
      AND r.status IN ('running', 'waiting_review', 'waiting_answer', 'needs_decision', 'waiting_timer')
      AND NOT ((xs.st -> 'after' ->> 'exclude_starter') = 'true' AND r.started_by = me.u)
      AND (EXISTS (SELECT 1 FROM hub.review_task_assignees a
                   WHERE a.task_id = t.id AND a.tenant_id = t.tenant_id AND a.user_id = me.u)
        OR (hg.gate IS NULL AND t.assignee_group_id = ANY (g.ids))
        OR hg.gate = me.u
        OR (t.escalated_at IS NOT NULL AND t.escalate_group_id = ANY (g.ids))
        OR coalesce(xs.st -> 'after' -> 'also_group_ids', '[]'::jsonb) ?| (g.ids::text[]))
    UNION ALL
    SELECT r.pack_record_id
    FROM hub.review_tasks t
    JOIN hub.process_runs r ON r.id = t.process_run_id AND r.tenant_id = t.tenant_id
    WHERE t.decided_by = me.u AND t.tenant_id = me.t AND t.kind = 'review'
      AND r.pack_key = 'contracts' AND r.pack_record_id IS NOT NULL) x
  WHERE me.u IS NOT NULL AND me.t IS NOT NULL AND x.id IS NOT NULL
$$;

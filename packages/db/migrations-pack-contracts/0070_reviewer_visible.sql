-- CR-109 · docs/specs/reviewer-visible · chế độ thấy `org`: người duyệt của bước engine ĐANG MỞ (cùng luật "Việc của tôi"
-- `openTasksOf`: được giao đích danh/chuyển tiếp ∪ Group của task (trừ khi có cửa trưởng phòng/người duyệt cụ thể) ∪ cửa đó ∪
-- Group chuyển cấp ∪ Group "cũng quyết"; trừ người gửi ở bước `exclude_starter`) và người ĐÃ quyết một bước của HĐ ĐỌC được HĐ
-- (+ hàng con qua EXISTS của chúng) dù ngoài cây quản lý của chủ HĐ. Chỉ ĐỌC: thêm policy RESTRICTIVE FOR UPDATE giữ luật cũ ⇒
-- người duyệt không sửa/khoá (FOR UPDATE) hàng HĐ, trừ lệnh duyệt lượt engine (cờ `app.approval_write`, xem cuối file). Chủ gói / chế độ tenant / việc nền như cũ (`sees_all()`). Chỉ cộng thêm.
--
-- `reviewer_contract_ids()` (SECURITY DEFINER như `org_owner_ids()` 0009: bảng hub/admin chỉ ENABLE RLS, chủ migration đọc được) —
-- không tham số, chỉ theo `app.tenant_id`/`app.user_id` của tx ⇒ role gói không hỏi được về người khác. MỘT mảng mỗi câu (InitPlan,
-- chỉ chạy khi `sees_all()` sai và hàng không thuộc cây). Hiệu năng (đường nóng danh sách HĐ):
--   (a) task mở: vào qua `process_runs_pack_open_idx (tenant_id, pack_key)` (run gói CHƯA kết thúc) → `review_tasks_run_idx`
--       → PK `stage_runs`; như `openTasksOf` (không quét lịch sử run đã xong).
--   (b) đã quyết — CÓ GIỚI HẠN (review bảo mật CR-109 #3): (b1) quyết trong 90 ngày qua: index một phần mới
--       `review_tasks_decided_by_idx (decided_by, tenant_id, decided_at)` (quét khoảng) → PK `process_runs`; (b2) run gói CHƯA kết
--       thúc mà mình đã quyết một bước (đi cùng nhánh (a) qua `process_runs_pack_open_idx` → `review_tasks_run_idx`). Quyết > 90
--       ngày trên run đã xong ⇒ không còn thấy (trừ khi thuộc cây).
--   Group của mình: `group_members_user_idx (user_id)`. Số đo: `tests/acceptance/CF/reviewer-visible.perf.int.test.ts`.
-- Migration gói chạy trong MỘT tx (drizzle migrator) ⇒ index không CONCURRENTLY (bảng nhỏ, một lần); `lock_timeout` để không treo
-- truy vấn của gói/hub sau một tx dài khi lấy khoá policy/index.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS review_tasks_decided_by_idx ON hub.review_tasks (decided_by, tenant_id, decided_at)
  WHERE decided_by IS NOT NULL AND kind = 'review';
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
      AND t.decided_at > now() - interval '90 days'
      AND r.pack_key = 'contracts' AND r.pack_record_id IS NOT NULL
    UNION ALL
    SELECT r.pack_record_id
    FROM hub.process_runs r
    JOIN hub.review_tasks t ON t.process_run_id = r.id AND t.tenant_id = r.tenant_id
      AND t.kind = 'review' AND t.decided_by = me.u
    WHERE r.tenant_id = me.t AND r.pack_key = 'contracts' AND r.pack_record_id IS NOT NULL
      AND r.status IN ('running', 'waiting_review', 'waiting_answer', 'needs_decision', 'waiting_timer')) x
  WHERE me.u IS NOT NULL AND me.t IS NOT NULL AND x.id IS NOT NULL
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION contracts.reviewer_contract_ids() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION contracts.reviewer_contract_ids() TO contracts_rw;
--> statement-breakpoint
-- Như 0016 + nhánh người duyệt (chỉ hàng HĐ gốc theo id; phụ lục không tự mở theo HĐ cha).
DROP POLICY IF EXISTS contracts_visible ON contracts.contracts;
--> statement-breakpoint
CREATE POLICY contracts_visible ON contracts.contracts AS RESTRICTIVE FOR SELECT TO contracts_rw
  USING ((SELECT contracts.sees_all() OR coalesce(current_setting('app.vis_cascade', true), '') = '1')
    OR owner_user_id = ANY ((SELECT contracts.org_owner_ids())::uuid[])
    OR (owner_user_id IS NULL
        AND (created_by = NULLIF(current_setting('app.user_id', true), '')::uuid
             OR visibility_owner_id = ANY ((SELECT contracts.org_owner_ids())::uuid[])))
    -- `IN (SELECT unnest(…))` ⇒ hashed SubPlan (O(1) mỗi hàng); `= ANY(mảng)` quét mảng tuyến tính mỗi hàng (đo: 2.000 HĐ × 700 id).
    OR id IN (SELECT unnest(contracts.reviewer_contract_ids())));
--> statement-breakpoint
-- Ghi/khoá (UPDATE, SELECT … FOR UPDATE) giữ ĐÚNG luật thấy trước CR-109; nhánh người duyệt CHỈ khi tx đặt cờ `app.approval_write`
-- (như `app.vis_cascade` 0016: chỉ code gói đặt, NGAY trước câu khoá/ghi của lệnh duyệt — `approvalWrite()` trong approval*.repo:
-- khoá trạng thái, từ chối, đọc lại, ghi Đã duyệt) ⇒ người duyệt KHÔNG sửa trường / gán người / xoá được qua lệnh khác.
DROP POLICY IF EXISTS contracts_visible_upd ON contracts.contracts;
--> statement-breakpoint
CREATE POLICY contracts_visible_upd ON contracts.contracts AS RESTRICTIVE FOR UPDATE TO contracts_rw
  USING ((SELECT contracts.sees_all() OR coalesce(current_setting('app.vis_cascade', true), '') = '1')
    OR owner_user_id = ANY ((SELECT contracts.org_owner_ids())::uuid[])
    OR (owner_user_id IS NULL
        AND (created_by = NULLIF(current_setting('app.user_id', true), '')::uuid
             OR visibility_owner_id = ANY ((SELECT contracts.org_owner_ids())::uuid[])))
    OR (coalesce(current_setting('app.approval_write', true), '') = '1'
        AND id IN (SELECT unnest(contracts.reviewer_contract_ids()))))
  -- hàng MỚI không bị luật thấy chặn (vd giao HĐ cho người ngoài cây — như trước CR-109); chỉ hàng CŨ phải thuộc cây.
  WITH CHECK (true);

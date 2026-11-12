import { sql } from "drizzle-orm";
import type { PackRunCaller } from "../../packs/kit/public";

/**
 * CR-127 · RA1 · việc «Xác nhận mốc» MỞ giao cho `u` (đích danh / nhóm của `u` / nhóm chuyển cấp) của run gói `packKey` — chỉ để ĐẾM
 * số trên menu (`inboxOf`); danh sách "Việc của tôi" lấy việc mốc từ nguồn riêng của gói. Cùng tập run chưa kết thúc như `openTasksFrom`.
 */
export const milestoneFrom = (u: PackRunCaller, packKey: string, groups: string) => sql`
      from hub.process_runs r
      join hub.review_tasks t on t.process_run_id = r.id and t.tenant_id = r.tenant_id
        and t.kind = 'milestone' and t.status = 'open'
      where r.tenant_id = ${u.tenantId} and r.pack_key = ${packKey} and r.pack_record_id is not null
        and r.status in ('running', 'waiting_review', 'waiting_answer', 'needs_decision', 'waiting_timer')
        and (exists (select 1 from hub.review_task_assignees a where a.task_id = t.id
                and a.tenant_id = t.tenant_id and a.user_id = ${u.userId})
          or t.assignee_group_id = any(${groups}::uuid[])
          or (t.escalated_at is not null and t.escalate_group_id = any(${groups}::uuid[])))`;

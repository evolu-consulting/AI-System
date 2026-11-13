// Tách khỏi pack-runs-view.ts cho ≤ 400 dòng: mệnh đề "task duyệt mở mà người xem quyết được" dùng chung cho danh sách + số đếm.
import { sql } from "drizzle-orm";
import type { PackRunCaller } from "../../packs/kit/public";
import { headGateSql } from "../core/head-gate.sql";
import type { ProcessDeps } from "../core/ports";

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const OPEN_GATE = headGateSql("x.st", "t.tenant_id", sql`t.assignee_group_id`);

/**
 * contract-flow S1b · "Việc của tôi": task review MỞ của run gói `packKey` mà `u` quyết được — cùng luật `canAct` (grant
 * user/chuyển tiếp ∪ Group duyệt có cửa trưởng phòng ∪ Group chuyển cấp; trừ người bắt đầu ở stage `exclude_starter`; run
 * chưa kết thúc). MỘT câu, scope user (RLS T) + lọc `tenant_id` tường minh; fix-review · vào qua index một phần run gói CHƯA
 * kết thúc `process_runs_pack_open_idx` (0060; điều kiện status khớp vị từ index) ⇒ không quét lịch sử run đã xong.
 */
/** Mệnh đề FROM/WHERE của "task duyệt mở mà `u` quyết được" — MỘT nguồn cho danh sách (`openTasksOf`) và số đếm (`inboxOf`). */
export const openTasksFrom = (u: PackRunCaller, packKey: string, groups: string) => sql`
      from hub.process_runs r
      join hub.review_tasks t on t.process_run_id = r.id and t.tenant_id = r.tenant_id
        and t.kind = 'review' and t.status = 'open'
      join hub.stage_runs s on s.id = t.stage_run_id and s.tenant_id = t.tenant_id
      cross join lateral (select r.snapshot->'stages'->(s.stage_idx::int) as st offset 0) x
      cross join lateral (select ${OPEN_GATE} as gate) hg
      where r.tenant_id = ${u.tenantId} and r.pack_key = ${packKey} and r.pack_record_id is not null
        and r.status in ('running', 'waiting_review', 'waiting_answer', 'needs_decision', 'waiting_timer')
        and not (x.st->'after'->>'exclude_starter' = 'true' and r.started_by = ${u.userId})
        and (exists (select 1 from hub.review_task_assignees a where a.task_id = t.id
                and a.tenant_id = t.tenant_id and a.user_id = ${u.userId})
          or (hg.gate is null and t.assignee_group_id = any(${groups}::uuid[]))
          or hg.gate = ${u.userId}::uuid
          or (t.escalated_at is not null and t.escalate_group_id = any(${groups}::uuid[]))
          or coalesce(x.st->'after'->'also_group_ids', '[]'::jsonb) ?| ${groups}::text[])`;

export const groupsOf = async (d: ProcessDeps, userId: string): Promise<string> => {
  const ids = [...((await d.config.user(userId))?.groupIds ?? [])].filter((g) => UUID.test(g));
  return `{${ids.join(",")}}`;
};

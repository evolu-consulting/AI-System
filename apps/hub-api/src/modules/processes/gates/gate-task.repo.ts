// HUB-FR-107 · §3.4 · PF1 · đọc task cho cổng kiểm (tách từ `gates.repo.ts`, prod-fix2 — giữ file ≤ 400 dòng): kiểu `GateTask`,
// cột Group chuyển cấp dùng chung, `loadTask` (không khoá — service khoá `process_runs` FOR UPDATE sau). Tx user; không log.
import type { DecisionReason, TaskKind, TaskStatus } from "@ai/contracts/chat";
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import { groupHeadSql } from "../core/head-gate.sql";

export type GateTask = {
  id: string;
  tenant_id: string;
  process_run_id: string;
  stage_run_id: string;
  stage_idx: number;
  kind: TaskKind;
  status: TaskStatus;
  assignee_group_id: string | null;
  /** PD-R21 · Group chuyển cấp (assignee `via='escalated'`) — thành viên cũng quyết được. */
  escalated_group_id: string | null;
  reason: DecisionReason | null;
  /** T19-perf · user assignee đọc cùng câu `loadTask`; S1b · `group_head` = trưởng phòng Group duyệt. */
  user_ids?: string[] | null;
  group_head?: string | null;
  /** prod-fix2 · Group "cũng quyết" của stage (`after.also_group_ids` trong snapshot run — bất biến). */
  also_group_ids?: string[] | null;
};

/** PD-R21 · Group `via='escalated'` của task (khớp `tenant_id` task; index `review_task_assignees` theo task). */
export const escalatedGroup = sql`(select a.group_id from hub.review_task_assignees a
  where a.task_id = t.id and a.tenant_id = t.tenant_id and a.via = 'escalated' and a.group_id is not null
  limit 1) as escalated_group_id`;

/** Task + stage_idx (không khoá). null = không thấy (RLS/tenant). Snapshot trích MỘT lần (lateral) cho `also_group_ids`. */
export async function loadTask(tx: Tx, taskId: string): Promise<GateTask | null> {
  const [r] = await tx.execute<GateTask>(sql`
    select t.id, t.tenant_id, t.process_run_id, t.stage_run_id, s.stage_idx, t.kind, t.status,
      t.assignee_group_id, ${escalatedGroup}, t.reason,
      array(select a.user_id from hub.review_task_assignees a where a.task_id = t.id and a.tenant_id = t.tenant_id
        and a.user_id is not null)::text[] as user_ids, ${groupHeadSql("t")} as group_head,
      array(select jsonb_array_elements_text(case when jsonb_typeof(x.ag) = 'array' then x.ag end))::text[]
        as also_group_ids
    from hub.review_tasks t
    join hub.stage_runs s on s.id = t.stage_run_id and s.tenant_id = t.tenant_id
    join hub.process_runs pr on pr.id = t.process_run_id and pr.tenant_id = t.tenant_id
    cross join lateral (select pr.snapshot->'stages'->(s.stage_idx::int)->'after'->'also_group_ids' as ag) x
    where t.id = ${taskId}`);
  return r ?? null;
}

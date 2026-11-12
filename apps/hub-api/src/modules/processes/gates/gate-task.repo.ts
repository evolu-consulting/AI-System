// HUB-FR-107 · §3.4 · PF1 · đọc task cho cổng kiểm (tách từ `gates.repo.ts`, prod-fix2 — giữ file ≤ 400 dòng): kiểu `GateTask`,
// cột Group chuyển cấp dùng chung, `loadTask` (không khoá — service khoá `process_runs` FOR UPDATE sau). Tx user; không log.
import type { DecisionReason, TaskKind, TaskStatus } from "@ai/contracts/chat";
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import { approverSql, groupHeadSql } from "../core/head-gate.sql";
import { delegatedLive } from "../core/task-grants.sql";

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
  /** CR-127 · E2 · Nhận việc: cần bao nhiêu người + người đang giữ (tên đọc cùng câu — báo `TASK_CLAIMED{by}`). */
  need?: string;
  claimed_by?: string | null;
  claimer_name?: string | null;
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
        and a.user_id is not null and ${delegatedLive("a")})::text[] as user_ids,
      coalesce(${approverSql("pr.snapshot->'stages'->(s.stage_idx::int)", "t.tenant_id")}, ${groupHeadSql("t")}) as group_head,
      array(select jsonb_array_elements_text(case when jsonb_typeof(x.ag) = 'array' then x.ag end))::text[]
        as also_group_ids,
      t.need, t.claimed_by, (select coalesce(nullif(u.display_name, ''), u.username) from admin.users u
        where u.id = t.claimed_by and u.tenant_id = t.tenant_id) as claimer_name
    from hub.review_tasks t
    join hub.stage_runs s on s.id = t.stage_run_id and s.tenant_id = t.tenant_id
    join hub.process_runs pr on pr.id = t.process_run_id and pr.tenant_id = t.tenant_id
    cross join lateral (select pr.snapshot->'stages'->(s.stage_idx::int)->'after'->'also_group_ids' as ag) x
    where t.id = ${taskId}`);
  return r ?? null;
}

/**
 * CR-127 · E4 · spec §5.3 · MỘT câu: ghi bằng chứng của quyết định (`hub.record_evidence`, subject `task_decision`) CÙNG tx `closeTask`.
 * Người quyết = `app.user_id` của tx; người quyết làm THAY A (hàng uỷ quyền `via='delegated'` còn hiệu lực của task) ⇒ `on_behalf_of = A`
 * (hàm DEFINER vẫn kiểm uỷ quyền — không mạo danh được). Tệp/chữ ký phải thuộc đúng tenant (hàm kiểm). Trả id bằng chứng.
 */
export async function recordTaskEvidence(
  tx: Tx,
  a: {
    tenantId: string;
    taskId: string;
    userId: string;
    evidence: {
      note: string;
      signature_attachment_id?: string;
      attachment_ids?: readonly string[];
    };
  },
): Promise<string> {
  const e = a.evidence;
  const files = `{${(e.attachment_ids ?? []).join(",")}}`;
  const [r] = await tx.execute<{ id: string }>(sql`
    select hub.record_evidence('task_decision', ${a.taskId}::uuid, ${e.note}::text,
      ${e.signature_attachment_id ?? null}::uuid, ${files}::uuid[],
      (select d.on_behalf_of from hub.review_task_assignees d
        where d.task_id = ${a.taskId}::uuid and d.tenant_id = ${a.tenantId}::uuid and d.user_id = ${a.userId}::uuid
          and d.via = 'delegated' and d.on_behalf_of is not null and ${delegatedLive("d")} limit 1))::text as id`);
  return (r as { id: string }).id;
}

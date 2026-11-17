// CR-181 · s9 · «bước đang mở» của bản ghi gói (vd HĐ) cho cổng lượt ký (BR-D1) và bước Ký trên tài liệu (BR-D3): lượt chạy còn mở gắn
// `pack_key + pack_record_id` (index `process_runs_pack_ref_idx`), bước hiện tại (định nghĩa trong snapshot), task duyệt đang mở của bước
// (người được giao còn hiệu lực, Group duyệt / chuyển cấp, người đã nhận) và Group của người gọi. MỘT câu, scope system, lọc `tenant_id`.
// Chỉ đọc; luật «ai có lượt» là luật thuần của gói (không lộ bảng hub cho gói).
import type { Db } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import { sql } from "drizzle-orm";
import { delegatedLive } from "../core/task-grants.sql";

const OPEN = `{running,waiting_review,waiting_answer,needs_decision,waiting_timer}`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type PackRecordTask = {
  userIds: string[];
  groupId: string | null;
  escalatedGroupId: string | null;
  claimedBy: string | null;
  need: string | null;
};
export type PackRecordStep = {
  runId: string;
  status: string;
  idx: number;
  /** Snapshot các stage của lượt (bất biến trong lượt). */
  stages: unknown[];
  /** Task duyệt đang mở của bước hiện tại (null ⇒ bước không phải duyệt / chưa mở). */
  task: PackRecordTask | null;
  /** Group của người gọi (để so Group duyệt / chuyển cấp / «cũng quyết»). */
  myGroups: string[];
};

type Row = {
  run_id: string;
  status: string;
  idx: number;
  stages: unknown[] | null;
  task_id: string | null;
  user_ids: string[] | null;
  group_id: string | null;
  esc_group_id: string | null;
  claimed_by: string | null;
  need: string | null;
  my_groups: string[] | null;
};

export async function packRecordStepOf(
  db: Db,
  q: { tenantId: string; packKey: string; recordId: string; userId: string },
): Promise<PackRecordStep | null> {
  if (!UUID.test(q.tenantId) || !UUID.test(q.recordId) || !UUID.test(q.userId)) return null;
  const [r] = await withHubScope(db, { kind: "system" }, (tx) =>
    tx.execute<Row>(sql`
      select pr.id::text as run_id, pr.status, pr.current_stage_idx as idx, pr.snapshot->'stages' as stages,
        t.id::text as task_id, t.assignee_group_id::text as group_id, t.claimed_by::text as claimed_by, t.need,
        case when t.id is null then null else array(select a.user_id::text from hub.review_task_assignees a
          where a.task_id = t.id and a.tenant_id = t.tenant_id and a.user_id is not null and ${delegatedLive("a")}) end as user_ids,
        (select a.group_id::text from hub.review_task_assignees a where a.task_id = t.id and a.tenant_id = t.tenant_id
          and a.via = 'escalated' and a.group_id is not null limit 1) as esc_group_id,
        array(select m.group_id::text from admin.group_members m
          where m.tenant_id = pr.tenant_id and m.user_id = ${q.userId}::uuid) as my_groups
      from hub.process_runs pr
      left join lateral (select t.* from hub.review_tasks t
          join hub.stage_runs s on s.id = t.stage_run_id and s.tenant_id = t.tenant_id
        where t.tenant_id = pr.tenant_id and t.process_run_id = pr.id and t.status = 'open' and t.kind = 'review'
          and s.stage_idx = pr.current_stage_idx
        limit 1) t on true
      where pr.tenant_id = ${q.tenantId}::uuid and pr.pack_key = ${q.packKey}
        and pr.pack_record_id = ${q.recordId}::uuid and pr.status = any(${OPEN}::text[])
      limit 1`),
  );
  if (!r) return null;
  return {
    runId: r.run_id,
    status: r.status,
    idx: Number(r.idx),
    stages: Array.isArray(r.stages) ? r.stages : [],
    task: r.task_id
      ? {
          userIds: r.user_ids ?? [],
          groupId: r.group_id,
          escalatedGroupId: r.esc_group_id,
          claimedBy: r.claimed_by,
          need: r.need,
        }
      : null,
    myGroups: r.my_groups ?? [],
  };
}

// CR-127 · E3 · spec §5.2 · R#13 · grant của task mới + áp uỷ quyền trong CÙNG MỘT câu (không thêm câu SQL mỗi lần giao việc):
// mỗi người được giao đích danh (user assignee) và người giữ cửa (trưởng phòng `head_only` / người duyệt cụ thể) có uỷ quyền còn
// hiệu lực đúng loại ⇒ thêm hàng `via='delegated', on_behalf_of=A` cho B (A vẫn giữ hàng của mình — hết khoảng "về A" vì hàng B chỉ
// có hiệu lực khi uỷ quyền còn sống, `delegatedLive`). Luật như `delegation.rules#resolveDelegate`: B ≠ người gửi, một bước, bản bắt
// đầu muộn nhất. Việc nhóm (`group_id`, need='one') KHÔNG áp.
import type { Tx } from "@ai/db";
import { type SQL, sql } from "drizzle-orm";
import { delegationKindsFor } from "../domain/tasks/delegation.rules";
import type { TaskKind } from "../domain/types";

export type GrantInput = {
  tenantId: string;
  taskId: string;
  runId: string;
  kind: TaskKind;
  userIds: readonly string[];
  groupId: string | null;
  /** Người giữ cửa của bước duyệt (đã tính ở `reviewTimingOf`); null = không có. */
  gate: string | null;
  /** CR-127 · E3b · R#15 · người duyệt duy nhất là người gửi ⇒ giao thêm (hàng `via='escalated'`). */
  escalated?: { userIds: readonly string[]; groupId: string | null } | null;
};

export async function insertGrants(tx: Tx, g: GrantInput): Promise<void> {
  const users = [...new Set(g.userIds)];
  const esc = g.escalated;
  const rows = [
    ...users.map((u) => ({ user_id: u, group_id: null, via: "initial" })),
    ...(g.groupId ? [{ user_id: null, group_id: g.groupId, via: "initial" }] : []),
    ...(esc?.userIds ?? [])
      .filter((u) => !users.includes(u))
      .map((u) => ({ user_id: u, group_id: null, via: "escalated" })),
    ...(esc?.groupId && esc.groupId !== g.groupId
      ? [{ user_id: null, group_id: esc.groupId, via: "escalated" }]
      : []),
  ];
  if (rows.length === 0) return;
  const kinds = `{${delegationKindsFor(g.kind).join(",")}}`;
  const holders = `{${[...new Set([...users, ...(g.gate ? [g.gate] : [])])].join(",")}}`;
  const taken = `{${users.join(",")}}`;
  await tx.execute(sql`
    insert into hub.review_task_assignees (tenant_id, task_id, user_id, group_id, via, depth, on_behalf_of)
    select ${g.tenantId}::uuid, ${g.taskId}::uuid, x.user_id, x.group_id, x.via, 0, null
    from jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) as x(user_id uuid, group_id uuid, via text)
    union all
    select distinct on (dl.to_user_id) ${g.tenantId}::uuid, ${g.taskId}::uuid, dl.to_user_id, null, 'delegated', 0,
      dl.from_user_id
    from unnest(${holders}::uuid[]) h(uid)
    cross join lateral (select d.to_user_id, d.from_user_id from hub.delegations d
      where d.tenant_id = ${g.tenantId}::uuid and d.from_user_id = h.uid and d.revoked_at is null
        and d.from_at <= now() and d.to_at > now() and d.kinds && ${kinds}::text[]
        and d.to_user_id <> all(${taken}::uuid[])
        and d.to_user_id is distinct from (select pr.started_by from hub.process_runs pr
          where pr.id = ${g.runId}::uuid and pr.tenant_id = ${g.tenantId}::uuid)
      order by d.from_at desc limit 1) dl`);
}

/**
 * Hàng assignee `a` còn hiệu lực: không phải hàng uỷ quyền, hoặc uỷ quyền on_behalf_of → user_id còn sống (chưa huỷ, trong khoảng).
 * Ghép vào câu đọc grant sẵn có (subquery theo `delegations_active_idx`) — không thêm câu.
 */
export function delegatedLive(a: string): SQL {
  const x = sql.raw(a);
  return sql`(${x}.via <> 'delegated' or exists (select 1 from hub.delegations dl
    where dl.tenant_id = ${x}.tenant_id and dl.from_user_id = ${x}.on_behalf_of and dl.to_user_id = ${x}.user_id
      and dl.revoked_at is null and dl.from_at <= now() and dl.to_at > now()))`;
}

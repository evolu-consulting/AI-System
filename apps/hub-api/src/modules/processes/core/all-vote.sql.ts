// CR-127 · E5 · spec §5.4 · R#14 · "Cần: tất cả": SQL dùng chung (thẻ việc `task-view` + cổng kiểm `gates/all-vote`) — một nguồn cho tập
// người bỏ phiếu + phiếu đã có. Người bỏ phiếu = hàng assignee `via='initial'` có `user_id` (chụp lúc tạo task: thành viên phòng còn dùng
// được, trừ người gửi); `usable` = còn active, không bị khoá, còn trong phòng của task ⇒ tính vào n (vô hiệu/rời phòng ⇒ loại).
import type { Tx } from "@ai/db";
import { type SQL, sql } from "drizzle-orm";
import type { Vote, VoteResult, Voter } from "../domain/tasks/all-vote.rules";

/** Cột jsonb `{voters:[{userId,usable}], votes:[{userId,result}]}` cho task alias `t` khi `need='all'`; khác ⇒ NULL. Hai subquery theo PK/chỉ mục task. */
export function allVoteSql(t: string): SQL {
  const a = sql.raw(t);
  return sql`case when ${a}.need = 'all' then jsonb_build_object(
    'voters', coalesce((select jsonb_agg(jsonb_build_object('userId', x.user_id, 'usable',
        (u.active and not u.locked_by_tenant and exists (select 1 from admin.group_members gm
          where gm.tenant_id = ${a}.tenant_id and gm.group_id = ${a}.assignee_group_id and gm.user_id = x.user_id)))
        order by x.user_id)
      from hub.review_task_assignees x join admin.users u on u.id = x.user_id and u.tenant_id = x.tenant_id
      where x.task_id = ${a}.id and x.tenant_id = ${a}.tenant_id and x.via = 'initial' and x.user_id is not null), '[]'::jsonb),
    'votes', coalesce((select jsonb_agg(jsonb_build_object('userId', vt.user_id, 'result', vt.result) order by vt.at)
      from hub.review_task_votes vt where vt.task_id = ${a}.id and vt.tenant_id = ${a}.tenant_id), '[]'::jsonb)) end`;
}

export type AllVoteJson = { voters: Voter[]; votes: Vote[] };

/** Đọc cột `allVoteSql` (driver có thể trả chuỗi). */
export function allVoteOf(raw: unknown): AllVoteJson | null {
  if (raw === null || raw === undefined) return null;
  const j = (typeof raw === "string" ? JSON.parse(raw) : raw) as AllVoteJson;
  return { voters: j.voters ?? [], votes: j.votes ?? [] };
}

/**
 * Cổng kiểm: tập bỏ phiếu + phiếu + người xem đang làm THAY ai (hàng uỷ quyền còn hiệu lực) + người xem có hàng chuyển cấp riêng.
 * MỘT câu; gọi SAU khi khoá run (đọc phiếu đã COMMIT của người trước).
 */
export async function allVoteFacts(
  tx: Tx,
  a: { taskId: string; tenantId: string; userId: string },
): Promise<AllVoteJson & { open: boolean; delegatedFor: string | null; escalatedUser: boolean }> {
  const [r] = await tx.execute<{
    av: unknown;
    open: boolean;
    delegated_for: string | null;
    esc: boolean;
  }>(sql`
    select ${allVoteSql("t")} as av, t.status = 'open' as open,
      (select d.on_behalf_of::text from hub.review_task_assignees d where d.task_id = t.id and d.tenant_id = t.tenant_id
        and d.user_id = ${a.userId}::uuid and d.via = 'delegated' and d.on_behalf_of is not null
        and exists (select 1 from hub.delegations dl where dl.tenant_id = d.tenant_id and dl.from_user_id = d.on_behalf_of
          and dl.to_user_id = d.user_id and dl.revoked_at is null and dl.from_at <= now() and dl.to_at > now())
        limit 1) as delegated_for,
      exists (select 1 from hub.review_task_assignees e where e.task_id = t.id and e.tenant_id = t.tenant_id
        and e.via = 'escalated' and e.user_id = ${a.userId}::uuid) as esc
    from hub.review_tasks t where t.id = ${a.taskId}::uuid and t.tenant_id = ${a.tenantId}::uuid`);
  const av = allVoteOf(r?.av) ?? { voters: [], votes: [] };
  return {
    ...av,
    open: r?.open === true,
    delegatedFor: r?.delegated_for ?? null,
    escalatedUser: r?.esc === true,
  };
}

/** Ghi phiếu (chỉ thêm; PK task+người) — trùng ⇒ false (bấm lại / A và B cùng bỏ). `user_id` = người được giao, `on_behalf_of` = người bỏ thay. */
export async function insertVote(
  tx: Tx,
  v: {
    taskId: string;
    tenantId: string;
    userId: string;
    onBehalfOf: string | null;
    result: VoteResult;
    evidenceId: string | null;
    at: Date;
  },
): Promise<boolean> {
  const rows = await tx.execute<{ task_id: string }>(sql`
    insert into hub.review_task_votes (task_id, tenant_id, user_id, on_behalf_of, result, evidence_id, at)
    values (${v.taskId}::uuid, ${v.tenantId}::uuid, ${v.userId}::uuid, ${v.onBehalfOf}::uuid, ${v.result},
      ${v.evidenceId}::uuid, ${v.at.toISOString()}::timestamptz)
    on conflict (task_id, user_id) do nothing returning task_id`);
  return rows.length > 0;
}

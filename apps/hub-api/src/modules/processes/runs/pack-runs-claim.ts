// CR-127 · RA2 · trường "nhận việc" của task mở trong `PackStepView.task` (stepsView): tái dùng `claimFields` (MỘT luật với
// `TaskDetail`) ⇒ `claim` / `need` / `can_reassign` đi tiếp tới FlowTask (ClaimBar + «Chuyển cho»). Cột lấy cùng câu `rowsSql`
// (lateral task, không thêm câu SQL); việc khác ⇒ không có trường. RA3 · cùng `votes` (x/n, `need='all'`), `delegated_from` (người xem
// làm thay A — hàng uỷ quyền còn hiệu lực), `evidence_mode` (`after.evidence`) như `TaskDetail`; grant + tên A lấy MỘT câu cho mọi task mở.
import type { TaskDetail } from "@ai/contracts/chat";
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import { allVoteOf, allVoteSql } from "../core/all-vote.sql";
import { claimFields, evidenceModeOf } from "../core/claim-fields";
import { groupHeadSql } from "../core/head-gate.sql";
import { delegatedLive } from "../core/task-grants.sql";
import { voteProgress } from "../domain/tasks/all-vote.rules";
import type { ReassignViewer } from "../domain/tasks/claim.rules";

/** Cột thêm của `rowsSql` (alias `t` = task review gần nhất của stage). */
export const CLAIM_COLS = sql`t.need, t.claimed_by, t.claimed_at,
    (select coalesce(nullif(cu.display_name, ''), cu.username) from admin.users cu
      where cu.id = t.claimed_by and cu.tenant_id = t.tenant_id) as claimer_name,
    ${groupHeadSql("t")} as assignee_head, ${allVoteSql("t")} as all_vote`;

export type ClaimCols = {
  need: "one" | "head" | "all" | null;
  claimed_by: string | null;
  claimed_at: Date | string | null;
  claimer_name: string | null;
  assignee_head: string | null;
  task_status: "open" | "closed" | null;
  assignee_group_id: string | null;
  all_vote: unknown;
};

/** Grant của các task mở (chỉ hàng uỷ quyền còn hiệu lực) + tên người được làm thay (`on_behalf_of`). MỘT câu; không task ⇒ 0 câu. */
export type Grant = {
  task_id: string;
  user_id: string | null;
  group_id: string | null;
  via: string;
  on_behalf_of: string | null;
  behalf_name: string | null;
};
export async function grantsOf(
  tx: Tx,
  tenantId: string,
  taskIds: readonly string[],
): Promise<Grant[]> {
  if (taskIds.length === 0) return [];
  return [
    ...(await tx.execute<Grant>(sql`select a.task_id, a.user_id, a.group_id, a.via, a.on_behalf_of,
        (select coalesce(nullif(b.display_name, ''), b.username) from admin.users b
          where b.id = a.on_behalf_of and b.tenant_id = a.tenant_id) as behalf_name
      from hub.review_task_assignees a
      where a.task_id = any(${`{${taskIds.join(",")}}`}::uuid[]) and a.tenant_id = ${tenantId} and ${delegatedLive("a")}`)),
  ];
}
export type TaskClaimPart = Pick<TaskDetail, "claim" | "need" | "can_reassign">;

export const claimOf = (
  r: ClaimCols,
  v: ReassignViewer,
  stage: { after?: unknown } | null | undefined,
  mine: readonly Grant[],
): TaskClaimPart => {
  const base = claimFields(
    {
      kind: "review",
      status: r.task_status ?? "closed",
      need: r.need,
      group_id: r.assignee_group_id,
      claimed_by: r.claimed_by,
      claimed_at: r.claimed_at,
      claimer_name: r.claimer_name,
      assignee_head: r.assignee_head,
    },
    v,
  );
  const av = r.need === "all" ? allVoteOf(r.all_vote) : null;
  const behalf = mine.find((g) => g.via === "delegated" && g.user_id === v.userId);
  const evidence = evidenceModeOf(
    (stage?.after as { evidence?: string } | null | undefined)?.evidence,
  );
  return {
    ...base,
    ...(av && { votes: voteProgress(av.voters, av.votes) }),
    ...(behalf?.on_behalf_of && {
      delegated_from: {
        id: behalf.on_behalf_of,
        display_name: behalf.behalf_name || behalf.on_behalf_of,
      },
    }),
    ...(evidence && { evidence_mode: evidence }),
  };
};

export const openTask = (
  id: string,
  a: { can: boolean; override: boolean; claim?: TaskClaimPart },
) => ({
  id,
  can_act: a.can,
  ...(a.can && a.override ? { override: true } : {}),
  ...a.claim,
});

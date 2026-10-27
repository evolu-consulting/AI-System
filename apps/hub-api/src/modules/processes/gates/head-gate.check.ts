// contract-flow S1b · cửa trưởng phòng (`after.head_only`) ở cổng quyết của engine (`GateService`). Chạy TRONG tx quyết định,
// sau khi khoá run (snapshot đã khoá ⇒ không đổi giữa chừng). Luật thuần: `headGate`/`inReviewGroup` (domain/tasks/task-access).
import type { Tx } from "@ai/db";
import { approverOf, headOf } from "../core/head-gate.sql";
import { alsoGroupsOf, headGate, inReviewGroup } from "../domain/tasks/task-access.rules";
import { type Locked, notFound, snapOf } from "./gates.effects";
import type { GateTask } from "./gates.repo";

type Req = { v: { userId: string }; groupIds: ReadonlySet<string> };
type StageAfter = ReturnType<typeof snapOf>["stages"][number]["after"];

/**
 * Chốt quyền task review theo snapshot run đã khoá: stage `head_only` + phòng có trưởng ⇒ Group duyệt chỉ còn trưởng phòng
 * (thành viên khác 404 như người ngoài); không cửa ⇒ thành viên Group như cũ. User assignee (chuyển tiếp) và Group chuyển cấp
 * không bị head_only. Run không thấy ⇒ 404.
 */
export function assertHeadGate(
  run: Locked | null | undefined,
  idx: number,
  task: GateTask,
  { v, groupIds }: Req,
): asserts run is Locked {
  if (!run) throw notFound();
  const after = snapOf(run).stages[idx]?.after;
  const gate = headGate(after, task.group_head ?? null);
  const esc = task.escalated_group_id;
  const ok =
    (task.user_ids ?? []).includes(v.userId) ||
    inReviewGroup(v.userId, groupIds, task.assignee_group_id, gate) ||
    (esc !== null && groupIds.has(esc)) ||
    alsoGroupsOf(after).some((g) => groupIds.has(g)); // prod-fix2 · không bị head_only
  if (!ok) throw notFound();
}

/** P-b2 D8 · người xem thuộc Group duyệt của stage (quyết `redo_limit`/`back_limit`); head_only ⇒ chỉ trưởng phòng. */
export async function reviewGroupMember(
  tx: Tx,
  run: Locked,
  after: StageAfter | undefined,
  { v, groupIds }: Req,
): Promise<boolean> {
  const group = after?.kind === "review" ? after.group_id : null;
  if (group === null) return false;
  // esign-flow-fix · người duyệt cụ thể chỉ là cửa khi còn hợp lệ ở tenant (active, không khoá).
  const raw = after?.kind === "review" ? after.approver_user_id : null;
  const approver = await approverOf(tx, run.tenantId, raw);
  const gated = after?.kind === "review" && after.head_only === true;
  const head = approver ?? (gated ? await headOf(tx, run.tenantId, group) : null);
  return inReviewGroup(v.userId, groupIds, group, head);
}

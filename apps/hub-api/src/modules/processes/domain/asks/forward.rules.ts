// HUB-FR-110 · HUB-FR-111 · PF2 · luật thuần nhờ/chuyển task (plan §3.4 Forward, plan-contract §7). QC test trước ở
// `tests/acceptance/P-a/pf2/rules/ask.test.ts`. Thứ tự lỗi khớp contract §3: kind → closed → limit → group/target.
import { FORWARD_CHAIN_MAX } from "../limits";
import type { TaskKind, TaskStatus } from "../types";

export type ForwardTask = {
  kind: TaskKind;
  status: TaskStatus;
  /** Số lần đã chuyển (assignee `via=forward`). */
  forwards: number;
  /** Group duyệt (review) — đích phải thuộc. */
  groupId: string | null;
  /** User đã là assignee (initial + đã chuyển) — không chuyển lại. */
  assigneeIds: ReadonlySet<string>;
  /** PD-R21: Group chuyển cấp (review) — cùng với groupId là tập Group hợp lệ. */
  escalatedGroupId?: string | null;
  /** PD-R21: Group người chuyển đang được gán; có ⇒ tập hợp lệ giao với nó. */
  byGroupIds?: ReadonlySet<string>;
};
export type ForwardTarget = {
  id: string;
  active: boolean;
  sameTenant: boolean;
  groupIds: ReadonlySet<string>;
};
export type ForwardCheck =
  | "ok"
  | "TASK_KIND_MISMATCH"
  | "REVIEW_TASK_CLOSED"
  | "FORWARD_LIMIT"
  | "FORWARD_OUT_OF_GROUP"
  | "FORWARD_TARGET_INVALID";

/** Review: {groupId, escalatedGroupId} ∩ yGroupIds (khi có); đích phải thuộc một Group trong tập (PD-R21). */
function reviewTargetOk(t: ForwardTask, to: ForwardTarget): boolean {
  const valid = [t.groupId, t.escalatedGroupId].filter(
    (g): g is string => g != null && (t.byGroupIds === undefined || t.byGroupIds.has(g)),
  );
  return valid.some((g) => to.groupIds.has(g));
}

/**
 * `by` = người chuyển (đã là assignee, route kiểm trước). Review: đích phải thuộc Group duyệt (HUB-FR-107); ask: user
 * active cùng tenant, ≠ chính mình, chưa là assignee (HUB-FR-111). Decision không chuyển được.
 */
export function forwardCheck(t: ForwardTask, to: ForwardTarget, by: string): ForwardCheck {
  if (t.kind === "decision") return "TASK_KIND_MISMATCH";
  if (t.status !== "open") return "REVIEW_TASK_CLOSED";
  if (t.forwards >= FORWARD_CHAIN_MAX) return "FORWARD_LIMIT";
  if (t.kind === "review") return reviewTargetOk(t, to) ? "ok" : "FORWARD_OUT_OF_GROUP";
  // ask
  if (!to.active || !to.sameTenant || to.id === by || t.assigneeIds.has(to.id))
    return "FORWARD_TARGET_INVALID";
  return "ok";
}

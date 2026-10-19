// HUB-FR-107 · HUB-FR-110 · HUB-FR-111 · HUB-FR-115 · M5 · luật quyền thao tác task dùng chung mọi PF (plan-step0 §1,
// plan-contract §7) — tách từ `core/task.rules.ts` (P-d1 T9s). Thuần. `canAct` là nguồn duy nhất của `TaskDetail.can_act`
// (PF1 view, PF2 answer/forward, PF3 inbox).
import { canDecide, type RunFacts, type Viewer } from "../runs/run-access.rules";
import { isTerminal } from "../runs/run-state.rules";
import type { DecisionReason, ProcessRunStatus, TaskKind, TaskStatus } from "../types";

export type TaskFacts = {
  kind: TaskKind;
  status: TaskStatus;
  reason: DecisionReason | null;
  /** Assignee user (gồm người được chuyển và người đã chuyển — vẫn giữ quyền). */
  userIds: ReadonlySet<string>;
  groupId: string | null;
  /** Group duyệt của stage (quyết `redo_limit`). */
  reviewGroupId: string | null;
  /** PD-R21 · Group thêm (chuyển cấp, `via='escalated'`) — thành viên cũng quyết được. Vắng ⇒ hành vi cũ. */
  extraGroupIds?: readonly string[];
  /** N2-FR-05 · task duyệt của stage `exclude_starter` ⇒ người bắt đầu không quyết. Vắng ⇒ hành vi cũ. */
  starterExcluded?: boolean;
};

/**
 * N2-FR-05 · N2-D06 · stage `after.review.exclude_starter` (snapshot cũ vắng ⇒ false): người bắt đầu run không được quyết
 * task duyệt của stage — kể cả là thành viên Group duyệt / chuyển cấp / người được chuyển. Không áp cho `decision`/`ask`.
 */
export function starterExcluded(
  after: { kind: string; exclude_starter?: boolean } | undefined,
  startedBy: string,
  userId: string,
): boolean {
  return after?.kind === "review" && after.exclude_starter === true && startedBy === userId;
}

export function canAct(
  v: Viewer & { groupIds: ReadonlySet<string> },
  t: TaskFacts,
  r: RunFacts & { status: ProcessRunStatus },
): boolean {
  if (v.role !== "platform_admin" && v.tenantId !== r.tenantId) return false;
  if (t.status !== "open" || isTerminal(r.status)) return false;
  if (t.kind === "review" && t.starterExcluded === true && r.startedBy === v.userId) return false;
  if (t.kind === "decision") {
    const reviewGroupMember = t.reviewGroupId !== null && v.groupIds.has(t.reviewGroupId);
    // Lý do vắng (dữ liệu hỏng) ⇒ chỉ người bắt đầu/admin: `interrupted` không mở quyền group.
    return canDecide(v, { ...r, reason: t.reason ?? "interrupted", reviewGroupMember });
  }
  if (t.userIds.has(v.userId) || (t.groupId !== null && v.groupIds.has(t.groupId))) return true;
  return (t.extraGroupIds ?? []).some((g) => v.groupIds.has(g));
}

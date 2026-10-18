// HUB-FR-107 · HUB-FR-110 · HUB-FR-111 · HUB-FR-115 · M5 · C4 · luật task dùng chung mọi PF (plan-step0 §1, plan-contract §7).
// Thuần. `canAct` là nguồn duy nhất của `TaskDetail.can_act` (PF1 view, PF2 answer/forward, PF3 inbox).
import type { DecisionReason, ProcessRunStatus, TaskKind, TaskStatus } from "@ai/contracts/chat";
import { TASK_EXCERPT_MAX } from "@ai/contracts/chat";
import { canDecide, type RunFacts, type Viewer } from "../domain/runs/run-access.rules";
import { isTerminal } from "../domain/runs/run-state.rules";

export type TaskFacts = {
  kind: TaskKind;
  status: TaskStatus;
  reason: DecisionReason | null;
  /** Assignee user (gồm người được chuyển và người đã chuyển — vẫn giữ quyền). */
  userIds: ReadonlySet<string>;
  groupId: string | null;
  /** Group duyệt của stage (quyết `redo_limit`). */
  reviewGroupId: string | null;
};

export function canAct(
  v: Viewer & { groupIds: ReadonlySet<string> },
  t: TaskFacts,
  r: RunFacts & { status: ProcessRunStatus },
): boolean {
  if (v.role !== "platform_admin" && v.tenantId !== r.tenantId) return false;
  if (t.status !== "open" || isTerminal(r.status)) return false;
  if (t.kind === "decision") {
    const reviewGroupMember = t.reviewGroupId !== null && v.groupIds.has(t.reviewGroupId);
    // Lý do vắng (dữ liệu hỏng) ⇒ chỉ người bắt đầu/admin: `interrupted` không mở quyền group.
    return canDecide(v, { ...r, reason: t.reason ?? "interrupted", reviewGroupMember });
  }
  return t.userIds.has(v.userId) || (t.groupId !== null && v.groupIds.has(t.groupId));
}

const HIGH_SURROGATE = /[\uD800-\uDBFF]$/;

/** C4 · ≤ `max` đơn vị UTF-16 đầu của input run (khớp `z.string().max`), không cắt đôi cặp surrogate. */
export function askExcerpt(input: string, max: number = TASK_EXCERPT_MAX): string {
  if (input.length <= max) return input;
  const cut = input.slice(0, max);
  return HIGH_SURROGATE.test(cut) ? cut.slice(0, -1) : cut;
}

// HUB-FR-107 · HUB-FR-110 · HUB-FR-111 · HUB-FR-115 · M5 · luật quyền thao tác task dùng chung mọi PF (plan-step0 §1,
// plan-contract §7) — tách từ `core/task.rules.ts` (P-d1 T9s). Thuần. `canAct` là nguồn duy nhất của `TaskDetail.can_act`
// (PF1 view, PF2 answer/forward, PF3 inbox).
import {
  canDecide,
  REVIEW_GROUP_REASONS,
  type RunFacts,
  type Viewer,
} from "../runs/run-access.rules";
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

/**
 * N2-D06 (sửa theo quyết định người dùng 2026-10-19, security M1): stage `exclude_starter` chặn người bắt đầu ở task `review`
 * VÀ task `decision` có lý do mở quyền Group duyệt (`redo_limit`/`back_limit` — `use_current` = coi như Đạt, lách cấp 2).
 * Decision lý do khác (lỗi agent, hết lượt thử…) không là duyệt ⇒ người bắt đầu vẫn quyết.
 */
export function starterGated(kind: TaskKind, reason: DecisionReason | null): boolean {
  return (
    kind === "review" ||
    (kind === "decision" && reason !== null && REVIEW_GROUP_REASONS.has(reason))
  );
}

/**
 * D3-07 · HD-FR-34 (mở rộng N2-D06, người dùng chốt 2026-10-19): ở stage `exclude_starter`, người bắt đầu không được chọn
 * `use_current` (= coi như Đạt — lách duyệt cấp 2) ở task `decision` với MỌI lý do; lựa chọn khác chỉ bị chặn khi lý do mở
 * quyền Group duyệt (`starterGated`). `add_attempt`/`cancel` của lỗi kỹ thuật không là duyệt ⇒ vẫn được.
 */
export function starterDecisionBlocked(
  after: { kind: string; exclude_starter?: boolean } | undefined,
  startedBy: string,
  userId: string,
  reason: DecisionReason,
  option: string,
): boolean {
  if (!starterExcluded(after, startedBy, userId)) return false;
  return option === "use_current" || starterGated("decision", reason);
}

export function canAct(
  v: Viewer & { groupIds: ReadonlySet<string> },
  t: TaskFacts,
  r: RunFacts & { status: ProcessRunStatus },
): boolean {
  if (v.role !== "platform_admin" && v.tenantId !== r.tenantId) return false;
  if (t.status !== "open" || isTerminal(r.status)) return false;
  if (t.starterExcluded === true && r.startedBy === v.userId && starterGated(t.kind, t.reason))
    return false;
  if (t.kind === "decision") {
    const reviewGroupMember = t.reviewGroupId !== null && v.groupIds.has(t.reviewGroupId);
    // Lý do vắng (dữ liệu hỏng) ⇒ chỉ người bắt đầu/admin: `interrupted` không mở quyền group.
    return canDecide(v, { ...r, reason: t.reason ?? "interrupted", reviewGroupMember });
  }
  if (t.userIds.has(v.userId) || (t.groupId !== null && v.groupIds.has(t.groupId))) return true;
  return (t.extraGroupIds ?? []).some((g) => v.groupIds.has(g));
}

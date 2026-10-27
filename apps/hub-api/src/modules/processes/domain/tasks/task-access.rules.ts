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
  /** contract-flow S1b · cửa trưởng phòng của stage `head_only` (= `headGate`); null/vắng ⇒ cả Group duyệt. */
  headGate?: string | null;
};

/**
 * contract-flow S1b · cửa trưởng phòng: stage `after.head_only` + Group duyệt có trưởng phòng ⇒ id trưởng phòng; còn lại
 * (không head_only, không Group, phòng không có trưởng) ⇒ null = cả nhóm như cũ.
 */
export function headGate(
  after:
    | {
        kind?: string;
        group_id?: string | null;
        head_only?: boolean;
        approver_user_id?: string | null;
      }
    | undefined
    | null,
  headUserId: string | null,
): string | null {
  // esign-flow · người duyệt cụ thể thay cả Group duyệt (thắng head_only) — CHỈ khi SQL đã xác nhận hợp lệ (`headUserId` = người đó:
  // cùng tenant, active, không khoá); không hợp lệ ⇒ rơi về cửa trưởng phòng / cả Group như stage thường.
  if (after?.kind === "review" && after.approver_user_id && headUserId === after.approver_user_id)
    return headUserId;
  if (after?.kind !== "review" || after.head_only !== true || !after.group_id) return null;
  return headUserId ?? null;
}

/**
 * contract-flow prod-fix2 · Group "cũng quyết" task duyệt của stage (`after.also_group_ids`, vd "Toàn quyền" của gói): như Group
 * chuyển cấp — thành viên quyết được, KHÔNG qua cửa trưởng phòng (head_only chỉ áp cho Group chính), vẫn chịu `exclude_starter`
 * (`canAct` kiểm trước). Stage không phải review / snapshot cũ ⇒ [].
 */
export function alsoGroupsOf(
  after: { kind?: string; also_group_ids?: readonly string[] | null } | undefined | null,
): string[] {
  if (after?.kind !== "review" || !Array.isArray(after.also_group_ids)) return [];
  return after.also_group_ids.filter((g): g is string => typeof g === "string");
}

/**
 * contract-flow S1b · người xem thuộc "Group duyệt" của task: có cửa trưởng phòng ⇒ chỉ đúng trưởng phòng (kể cả khi trưởng
 * phòng không nằm trong `group_members`); không cửa ⇒ thành viên Group. Group chuyển cấp KHÔNG qua hàm này (không bị head_only).
 */
export function inReviewGroup(
  userId: string,
  groupIds: ReadonlySet<string>,
  groupId: string | null,
  gate: string | null | undefined,
): boolean {
  if (groupId === null) return false;
  if (gate) return gate === userId;
  return groupIds.has(groupId);
}

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
  d: { reason: DecisionReason; option: string },
): boolean {
  if (!starterExcluded(after, startedBy, userId)) return false;
  return d.option === "use_current" || starterGated("decision", d.reason);
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
  // S1b · cửa trưởng phòng chỉ áp cho task duyệt/decision của stage (ask có người trả lời riêng).
  const gate = t.kind === "ask" ? null : t.headGate;
  if (t.kind === "decision") {
    const reviewGroupMember = inReviewGroup(v.userId, v.groupIds, t.reviewGroupId, gate);
    // Lý do vắng (dữ liệu hỏng) ⇒ chỉ người bắt đầu/admin: `interrupted` không mở quyền group.
    return canDecide(v, { ...r, reason: t.reason ?? "interrupted", reviewGroupMember });
  }
  if (t.userIds.has(v.userId) || inReviewGroup(v.userId, v.groupIds, t.groupId, gate)) return true;
  return (t.extraGroupIds ?? []).some((g) => v.groupIds.has(g));
}

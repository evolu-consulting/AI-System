// CR-127 · E2 · spec §5.1 · gap-b §4.A · luật thuần "Nhận việc" (task `need='one'` giao phòng/nhóm): trạng thái nhận theo người
// xem, ai bị chặn quyết khi người khác đã nhận, lỗi khi nhận hụt, hạn tự trả, người nhận thông báo tự trả (trưởng phòng; không có
// ⇒ quản trị công ty — R#27). Không I/O.

export type ClaimState = "unclaimed" | "mine" | "other";
export type TaskNeed = "one" | "head" | "all";

/** Kind task nhận được (việc nhóm): duyệt + Xác nhận mốc. `ask`/`decision` giao đích danh ⇒ không nhận. */
export const CLAIMABLE_KINDS: ReadonlySet<string> = new Set(["review", "milestone"]);

export function claimState(claimedBy: string | null | undefined, viewerId: string): ClaimState {
  if (!claimedBy) return "unclaimed";
  return claimedBy === viewerId ? "mine" : "other";
}

/** `canAct` · `need='one'` (vắng = 'one') + người khác đang giữ ⇒ chặn (`block_reason='claimed_by_other'`). */
export function claimBlocks(
  t: { need?: TaskNeed | null; claimedBy?: string | null },
  viewerId: string,
): boolean {
  return (t.need ?? "one") === "one" && claimState(t.claimedBy, viewerId) === "other";
}

/** Task nhận được: việc nhóm (`assignee_group_id`) loại duyệt/mốc, `need='one'`. */
export function claimable(t: { kind: string; need: string; groupId: string | null }): boolean {
  return t.need === "one" && t.groupId !== null && CLAIMABLE_KINDS.has(t.kind);
}

/** Hàng đọc lại khi câu nhận trả 0 hàng (đua / sai trạng thái / không thuộc nhóm). */
export type ClaimMiss = {
  status: "open" | "closed";
  kind: string;
  need: string;
  groupId: string | null;
  claimedBy: string | null;
  member: boolean;
  /** SEC 2026-11-12 · người xem là người gửi lượt chạy và bước bật `exclude_starter` (cùng nguồn `starterExcluded`). Vắng ⇒ false. */
  starterExcluded?: boolean;
};
export type ClaimMissOutcome =
  | "not_found"
  | "TASK_CLOSED"
  | "TASK_NOT_CLAIMABLE"
  | "STARTER_CANNOT_REVIEW"
  | "TASK_CLAIMED"
  | "mine";

/** Thứ tự: không thấy/không thuộc nhóm ⇒ 404 (không lộ task) · đã xong · không cần nhận · người gửi bị loại (`exclude_starter`) · mình đã giữ (idempotent) · người khác. */
export function claimMissOutcome(m: ClaimMiss | null, viewerId: string): ClaimMissOutcome {
  if (!m) return "not_found";
  if (!m.member && m.claimedBy !== viewerId) return "not_found";
  if (m.status !== "open") return "TASK_CLOSED";
  if (!claimable(m)) return "TASK_NOT_CLAIMABLE";
  if (m.starterExcluded === true && m.claimedBy !== viewerId) return "STARTER_CANNOT_REVIEW";
  if (m.claimedBy === viewerId) return "mine";
  return m.claimedBy ? "TASK_CLAIMED" : "TASK_NOT_CLAIMABLE";
}

/** Hạn tự trả = lúc nhận + giờ của công ty (`tenant_flow_settings.claim_release_h`, 1..168). */
export function claimDeadline(at: Date, hours: number): Date {
  return new Date(at.getTime() + hours * 3_600_000);
}

export const CLAIM_HOURS = { min: 1, max: 168, default: 24 } as const;
export function claimHoursOk(h: unknown): h is number {
  return (
    Number.isInteger(h) && (h as number) >= CLAIM_HOURS.min && (h as number) <= CLAIM_HOURS.max
  );
}

/** R#27 · báo tự trả: trưởng phòng của nhóm; nhóm không có trưởng phòng ⇒ mọi quản trị công ty. */
export function releaseRecipients(head: string | null, tenantAdmins: readonly string[]): string[] {
  return head ? [head] : [...new Set(tenantAdmins)];
}

export type ReassignViewer = { userId: string; role: "platform_admin" | "tenant_admin" | "member" };
export type ReassignFacts = {
  status: string;
  kind: string;
  need: string;
  groupId: string | null;
  /** Trưởng phòng của nhóm được giao (`admin.departments.head_user_id`); null = không có. */
  head: string | null;
};
export type ReassignBlock = "NOT_GROUP_HEAD" | "TASK_CLOSED" | "TASK_NOT_CLAIMABLE";

/** Giao cho người khác: trưởng phòng của nhóm hoặc quản trị công ty (platform_admin luôn được). */
export function mayReassign(v: ReassignViewer, head: string | null): boolean {
  return v.role !== "member" || (head !== null && head === v.userId);
}

/**
 * MỘT luật cho "Giao cho người khác": `POST /review-tasks/:id/reassign` (thứ tự lỗi: không phải trưởng phòng/quản trị ⇒ đã xong
 * ⇒ không nhận được) và cờ `can_reassign` của `TaskDetail` (= không có lỗi). Người nhận có trong nhóm là điều kiện theo đích, ngoài cờ.
 */
export function reassignBlock(v: ReassignViewer, t: ReassignFacts): ReassignBlock | null {
  if (!mayReassign(v, t.head)) return "NOT_GROUP_HEAD";
  if (t.status !== "open") return "TASK_CLOSED";
  if (!claimable(t)) return "TASK_NOT_CLAIMABLE";
  return null;
}

export const canReassign = (v: ReassignViewer, t: ReassignFacts): boolean =>
  reassignBlock(v, t) === null;

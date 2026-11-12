// CR-127 · E5 · spec §5.4 · R#13 · R#14 · Q12 · luật thuần "Cần: tất cả" (`review_tasks.need='all'`): mỗi người trong tập bỏ phiếu
// (thành viên phòng lúc tạo task, trừ người gửi/người vô hiệu) một phiếu; đủ n/n Duyệt ⇒ bước qua; một Trả lại/Từ chối ⇒ kết quả ngay.
// Người bị vô hiệu / rời phòng SAU khi tạo task ⇒ loại khỏi n (tính lại ở phiếu kế tiếp). Khác "A + B cùng duyệt" (CR-125: một thẻ mỗi
// nhóm) — ở đây MỘT thẻ, nhiều phiếu (`hub.review_task_votes`). Không I/O.

export type VoteResult = "pass" | "fail" | "reject";

/** Một người trong tập bỏ phiếu (hàng assignee `via='initial'` của task) + còn được tính vào n không. */
export type Voter = { userId: string; usable: boolean };
export type Vote = { userId: string; result: VoteResult };

/** n hiện tại: người bỏ phiếu còn dùng được (active, không khoá, còn trong phòng). */
export function requiredVoters(voters: readonly Voter[]): string[] {
  return voters.filter((v) => v.usable).map((v) => v.userId);
}

/** Tiến độ hiện trên thẻ (x/n): x = phiếu Duyệt của người còn tính. */
export function voteProgress(
  voters: readonly Voter[],
  votes: readonly Vote[],
): { done: number; total: number } {
  const req = new Set(requiredVoters(voters));
  const done = votes.filter((v) => v.result === "pass" && req.has(v.userId)).length;
  return { done, total: req.size };
}

/**
 * Người xem bỏ phiếu với tư cách ai: chính mình (có trong tập) hoặc THAY A (hàng uỷ quyền còn hiệu lực `on_behalf_of=A`, A trong tập).
 * - `voted`: phiếu của tư cách đó đã có (bấm lại / A đã tự bỏ) ⇒ 409.
 * - `excluded`: người xem trong tập nhưng đã bị loại khỏi n (rời phòng) ⇒ không được bỏ phiếu.
 * - `none`: không phải người bỏ phiếu (chỉ được quyết như việc một người nếu có quyền khác: chuyển cấp / nhóm "cũng quyết").
 */
export type VoteAs =
  | { kind: "vote"; userId: string; onBehalfOf: string | null }
  | { kind: "voted" }
  | { kind: "excluded" }
  | { kind: "none" };

export function voteAs(
  viewerId: string,
  voters: readonly Voter[],
  votes: readonly Vote[],
  delegatedFor: string | null,
): VoteAs {
  const voted = new Set(votes.map((v) => v.userId));
  const self = voters.find((v) => v.userId === viewerId);
  if (self) {
    if (voted.has(viewerId)) return { kind: "voted" };
    return self.usable
      ? { kind: "vote", userId: viewerId, onBehalfOf: null }
      : { kind: "excluded" };
  }
  const a = delegatedFor ? voters.find((v) => v.userId === delegatedFor && v.usable) : undefined;
  if (!a) return { kind: "none" };
  return voted.has(a.userId)
    ? { kind: "voted" }
    : { kind: "vote", userId: a.userId, onBehalfOf: viewerId };
}

/**
 * Phiếu này chốt bước chưa (phiếu đã có KHÔNG gồm phiếu này). Trả lại/Từ chối ⇒ `final` ngay; Duyệt ⇒ `final` khi mọi người còn tính
 * khác đã Duyệt (phiếu Trả lại/Từ chối cũ không thể còn — task đã đóng ở phiếu đó).
 */
export function voteVerdict(
  voters: readonly Voter[],
  votes: readonly Vote[],
  mine: { userId: string; result: VoteResult },
): "partial" | "final" {
  if (mine.result !== "pass") return "final";
  const passed = new Set(votes.filter((v) => v.result === "pass").map((v) => v.userId));
  passed.add(mine.userId);
  return requiredVoters(voters).every((id) => passed.has(id)) ? "final" : "partial";
}

/**
 * n = 0 lúc tạo task (spec §5.4): giao "Quá hạn chuyển cho" của bước như việc một người (người > nhóm); không có ⇒ quản trị công ty
 * (trừ người gửi). Không ai ⇒ null (task vẫn mở, chờ chuyển cấp / quản trị xử lý lượt).
 */
export function zeroVoterTargets(
  starter: string | null,
  esc: { userId: string | null; groupId: string | null; adminIds: readonly string[] },
): { userIds: string[]; groupId: string | null } | null {
  if (esc.userId && esc.userId !== starter) return { userIds: [esc.userId], groupId: null };
  if (esc.groupId) return { userIds: [], groupId: esc.groupId };
  const admins = [...new Set(esc.adminIds.filter((a) => a !== starter))];
  return admins.length > 0 ? { userIds: admins, groupId: null } : null;
}

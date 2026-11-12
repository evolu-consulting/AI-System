// CR-127 · E3 · spec §5.2 · gap-b §4.B · R#13/R#15/R#43 · luật thuần uỷ quyền A → B trong khoảng [from_at, to_at): kiểm khi lưu
// (tự mình / ai được đặt thay / không chuỗi / người ký), chọn người làm thay khi giao việc (`resolveDelegate`), ai xem được.
// Phạm vi áp (R#13): việc giao đích danh + cửa trưởng phòng/người duyệt cụ thể; việc nhóm `need='one'` KHÔNG áp. Không I/O.
import type { TaskKind } from "../types";

export type DelegationKind = "approve" | "form" | "milestone" | "esign";
export type DelegationRow = {
  id?: string;
  fromUserId: string;
  toUserId: string;
  fromAt: Date;
  toAt: Date;
  kinds: readonly DelegationKind[];
  revokedAt?: Date | null;
};

export const active = (d: DelegationRow, at: Date): boolean =>
  !d.revokedAt && d.fromAt.getTime() <= at.getTime() && at.getTime() < d.toAt.getTime();

const overlaps = (a: { fromAt: Date; toAt: Date }, b: { fromAt: Date; toAt: Date }): boolean =>
  a.fromAt.getTime() < b.toAt.getTime() && b.fromAt.getTime() < a.toAt.getTime();

/** Loại uỷ quyền áp cho loại task: duyệt (gồm bước form) ⇒ approve|form; Xác nhận mốc ⇒ milestone; hỏi/quyết định ⇒ không. */
export function delegationKindsFor(kind: TaskKind): DelegationKind[] {
  if (kind === "review") return ["approve", "form"];
  if (kind === "milestone") return ["milestone"];
  return [];
}

/**
 * Người làm thay của `assignee` cho task loại `kind` lúc `at`: uỷ quyền còn hiệu lực đúng loại, B ≠ người gửi (R#15 — không để
 * người gửi tự duyệt việc của mình), một bước (không chuỗi). Nhiều bản trùng ⇒ bản bắt đầu muộn nhất. Không có ⇒ null.
 */
export function resolveDelegate(
  assignee: string,
  kind: TaskKind,
  at: Date,
  delegations: readonly DelegationRow[],
  o: { starterId: string | null },
): string | null {
  const kinds = delegationKindsFor(kind);
  if (kinds.length === 0) return null;
  const hit = delegations
    .filter((d) => d.fromUserId === assignee && active(d, at))
    .filter((d) => d.kinds.some((k) => kinds.includes(k)))
    .filter((d) => d.toUserId !== o.starterId && d.toUserId !== assignee)
    .sort((a, b) => b.fromAt.getTime() - a.fromAt.getTime())[0];
  return hit?.toUserId ?? null;
}

export type DelegationCode =
  | "ok"
  | "DELEGATE_SELF"
  | "DELEGATE_FORBIDDEN"
  | "DELEGATE_CHAIN"
  | "DELEGATE_NOT_SIGNER";

export type Actor = { userId: string; role: "platform_admin" | "tenant_admin" | "member" };

/** Đặt thay người khác (`for_user_id`): quản trị công ty hoặc trưởng phòng của người đó. Chính mình ⇒ luôn được. */
export function mayManageFor(
  actor: Actor,
  fromUserId: string,
  headsOfFrom: readonly string[],
): boolean {
  if (actor.userId === fromUserId) return true;
  return actor.role !== "member" || headsOfFrom.includes(actor.userId);
}

/**
 * Kiểm khi lưu A → B: tự mình (SELF) · ai được đặt (FORBIDDEN) · chuỗi (B đang uỷ quyền tiếp, hoặc A đang làm thay người khác,
 * trong khoảng chồng — CHAIN) · ký số chỉ cho người thuộc nhóm Người ký HĐ (NOT_SIGNER). `existing` = uỷ quyền chưa huỷ của A và B.
 */
export function delegationCheck(
  d: Omit<DelegationRow, "revokedAt">,
  c: {
    actor: Actor;
    headsOfFrom: readonly string[];
    existing: readonly DelegationRow[];
    toIsSigner: boolean;
  },
): DelegationCode {
  if (d.fromUserId === d.toUserId) return "DELEGATE_SELF";
  if (!mayManageFor(c.actor, d.fromUserId, c.headsOfFrom)) return "DELEGATE_FORBIDDEN";
  const live = c.existing.filter((e) => !e.revokedAt && overlaps(e, d));
  const chain = live.some(
    (e) =>
      e.fromUserId === d.toUserId || // B đang uỷ quyền tiếp
      e.toUserId === d.fromUserId, // A đang làm thay người khác
  );
  if (chain) return "DELEGATE_CHAIN";
  if (d.kinds.includes("esign") && !c.toIsSigner) return "DELEGATE_NOT_SIGNER";
  return "ok";
}

export type SoleTargets = { userIds: string[]; groupId: string | null };

/**
 * R#15 · BR-21 · người duyệt duy nhất của bước là người gửi (cửa trưởng phòng/người duyệt cụ thể, hoặc một người đích danh) ⇒ giao
 * thêm cho đích "Quá hạn chuyển cho" của bước (người > nhóm); không có ⇒ quản trị công ty. Không phải trường hợp đó ⇒ null.
 */
export function soleStarterTargets(
  t: { gate: string | null; soleUser: string | null; starter: string | null },
  esc: { userId: string | null; groupId: string | null; adminIds: readonly string[] },
): SoleTargets | null {
  if (!t.starter || (t.gate !== t.starter && t.soleUser !== t.starter)) return null;
  if (esc.userId && esc.userId !== t.starter) return { userIds: [esc.userId], groupId: null };
  if (esc.groupId) return { userIds: [], groupId: esc.groupId };
  const admins = esc.adminIds.filter((a) => a !== t.starter);
  return admins.length > 0 ? { userIds: [...new Set(admins)], groupId: null } : null;
}

/** R#43 · ai xem uỷ quyền: bản thân (from/to) ∪ quản trị công ty ∪ trưởng phòng của người uỷ quyền. */
export function mayViewDelegation(
  actor: Actor,
  d: Pick<DelegationRow, "fromUserId" | "toUserId">,
  headsOfFrom: readonly string[],
): boolean {
  if (actor.userId === d.fromUserId || actor.userId === d.toUserId) return true;
  return actor.role !== "member" || headsOfFrom.includes(actor.userId);
}

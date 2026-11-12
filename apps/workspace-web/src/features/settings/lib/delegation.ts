// CR-127 · U4 · M14 · BR-31…34 · uỷ quyền khi vắng: luật thuần của biểu mẫu (người làm thay, khoảng ngày, loại việc) + lọc bản còn hiệu lực.
import {
  CLAIM_RELEASE_H,
  type CreateDelegationRequest,
  DELEGATION_KINDS,
  type Delegation,
  type DelegationKind,
} from "@ai/contracts/chat";

export type DelegationForm = {
  toUserId: string;
  /** `YYYY-MM-DD` (ô ngày). */
  from: string;
  /** `YYYY-MM-DD` — «Tới hết» ngày này. */
  to: string;
  kinds: readonly DelegationKind[];
  /** Quản trị / trưởng phòng đặt thay người khác ("" = chính mình). */
  forUserId: string;
};

export const EMPTY_DELEGATION: DelegationForm = {
  toUserId: "",
  from: "",
  to: "",
  kinds: ["approve", "form", "milestone"],
  forUserId: "",
};
export { DELEGATION_KINDS };

export type DelegationIssue = "person" | "self" | "range" | "kinds" | null;

export function delegationIssue(f: DelegationForm, me: string | null): DelegationIssue {
  if (f.toUserId === "") return "person";
  if (f.toUserId === (f.forUserId || me)) return "self";
  if (f.from === "" || f.to === "" || f.to < f.from) return "range";
  if (f.kinds.length === 0) return "kinds";
  return null;
}

/** Khoảng ngày ⇒ ISO: từ đầu ngày «Từ», tới HẾT ngày «Tới» (24:00 = đầu ngày kế, giờ máy). */
export function delegationBody(f: DelegationForm): CreateDelegationRequest {
  const to = new Date(`${f.to}T00:00:00`);
  to.setDate(to.getDate() + 1);
  return {
    to_user_id: f.toUserId,
    from_at: new Date(`${f.from}T00:00:00`).toISOString(),
    to_at: to.toISOString(),
    kinds: [...f.kinds],
    ...(f.forUserId ? { for_user_id: f.forUserId } : {}),
  };
}

/** Bản chưa thu hồi và chưa hết hạn (cái đang/sắp có hiệu lực), hết hạn gần trước. */
export function activeDelegations(items: readonly Delegation[], now: number): Delegation[] {
  return items
    .filter((d) => d.revoked_at === null && Date.parse(d.to_at) > now)
    .sort((a, b) => Date.parse(a.to_at) - Date.parse(b.to_at));
}

export const toggleKind = (ks: readonly DelegationKind[], k: DelegationKind): DelegationKind[] =>
  ks.includes(k) ? ks.filter((x) => x !== k) : [...ks, k];

/** Giờ tự trả việc đã nhận: số nguyên 1..168. */
export const claimHoursIssue = (h: number): boolean =>
  !Number.isInteger(h) || h < CLAIM_RELEASE_H.min || h > CLAIM_RELEASE_H.max;

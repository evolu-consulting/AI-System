// ADM-FR-74, ADM-FR-75 · trạng thái và hành động của tài khoản đối tác (hàm thuần).
import type { User } from "@ai/contracts";

export type PartnerUserStatus = "active" | "locked" | "deactivated";

type StatusFields = Pick<User, "active" | "locked_by_tenant" | "locked_until"> &
  Partial<Pick<User, "deactivated_at">>;

/** `Đã vô hiệu` (không hoàn tác) > `Đã khoá` (khoá tay/theo tenant/tạm khoá còn hạn) > `Hoạt động`. */
export function partnerUserStatus(u: StatusFields, now: Date): PartnerUserStatus {
  if (u.deactivated_at) return "deactivated";
  const tempLocked = !!u.locked_until && new Date(u.locked_until).getTime() > now.getTime();
  return !u.active || u.locked_by_tenant || tempLocked ? "locked" : "active";
}

export type PartnerUserActions = {
  resetPassword: boolean;
  lock: boolean;
  unlock: boolean;
  deactivate: boolean;
};

/** Tài khoản đã vô hiệu: không còn hành động nào. Mở khoá chỉ khi công ty còn hoạt động. */
export function partnerUserActions(
  u: StatusFields,
  orgActive: boolean,
  now: Date,
): PartnerUserActions {
  const status = partnerUserStatus(u, now);
  if (status === "deactivated") {
    return { resetPassword: false, lock: false, unlock: false, deactivate: false };
  }
  return {
    resetPassword: true,
    lock: status === "active",
    unlock: status === "locked" && orgActive,
    deactivate: true,
  };
}

export type PartnerUserActionKind = "resetPassword" | "lock" | "unlock" | "deactivate";

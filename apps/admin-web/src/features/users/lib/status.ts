// ADM-FR-04, ADM-FR-05 · trạng thái hiển thị của một user trong bảng (hàm thuần).
import type { User } from "@ai/contracts";

export type UserActionKind = "lock" | "unlock" | "reset" | "logoutAll" | "disable2fa";

export type UserStatusView =
  | { kind: "locked"; byTenant: boolean }
  | { kind: "tempLocked"; until: string }
  | { kind: "active" };

type StatusFields = Pick<User, "active" | "locked_by_tenant" | "locked_until">;

/** `Đã khoá` nếu `!active || locked_by_tenant`; `Tạm khoá đến …` nếu `locked_until` còn hiệu lực; còn lại hoạt động. */
export function userStatusView(u: StatusFields, now: Date): UserStatusView {
  if (!u.active || u.locked_by_tenant) return { kind: "locked", byTenant: u.locked_by_tenant };
  if (u.locked_until && new Date(u.locked_until).getTime() > now.getTime()) {
    return { kind: "tempLocked", until: u.locked_until };
  }
  return { kind: "active" };
}

export type RowActions = {
  resetPassword: boolean;
  lock: boolean;
  unlock: boolean;
  unlockEnabled: boolean;
  logoutAll: boolean;
  /** ADM-FR-08 · "Tắt 2FA" hộ user: chỉ khi user đã bật 2FA và không phải chính mình. */
  disable2fa: boolean;
};

/** Menu `⋯` ngoài "Sửa": hàng "(bạn)" chỉ có Sửa (D12); Mở khoá bị vô hiệu khi user bị khoá theo tenant. */
export function rowActions(
  u: StatusFields & Partial<Pick<User, "totp_enabled">>,
  isSelf: boolean,
  now: Date,
): RowActions {
  if (isSelf) {
    return {
      resetPassword: false,
      lock: false,
      unlock: false,
      unlockEnabled: false,
      logoutAll: false,
      disable2fa: false,
    };
  }
  const view = userStatusView(u, now);
  return {
    resetPassword: true,
    lock: view.kind === "active",
    unlock: view.kind !== "active",
    unlockEnabled: !u.locked_by_tenant,
    logoutAll: true,
    disable2fa: u.totp_enabled === true,
  };
}

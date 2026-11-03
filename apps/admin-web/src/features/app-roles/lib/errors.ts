// CR-112 · ADM-FR-80, ADM-FR-82 · mã lỗi `/admin/app-roles*` → key i18n (mã chung đã có ở `describeError`).
import { describeError, type MessageSpec } from "@/lib/errors";
import { ApiError } from "@/lib/http";

/** 409 VERSION_CONFLICT: vai đã đổi ở nơi khác ⇒ tải lại, không ghi đè. */
export const isVersionConflict = (err: unknown): boolean =>
  err instanceof ApiError && (err.code as string) === "VERSION_CONFLICT";

const memberCount = (details: unknown): number => {
  const n = (details as { member_count?: unknown } | null | undefined)?.member_count;
  return typeof n === "number" ? n : 0;
};

export function describeRoleError(err: unknown): MessageSpec {
  if (err instanceof ApiError) {
    const code = err.code as string;
    if (code === "VERSION_CONFLICT") return { key: "appRoles.error.conflict" };
    if (code === "DEFAULT_ROLE_PROTECTED") return { key: "appRoles.error.defaultProtected" };
    if (code === "ROLE_HAS_MEMBERS") {
      return { key: "appRoles.error.hasMembers", params: { count: memberCount(err.details) } };
    }
    if (code === "PACK_NOT_ROLEABLE") return { key: "appRoles.error.notRoleable" };
    if (code === "KEY_TAKEN") return { key: "appRoles.error.keyTaken" };
    if (code === "ROLE_KEY_RESERVED") return { key: "appRoles.error.keyReserved" };
  }
  return describeError(err);
}

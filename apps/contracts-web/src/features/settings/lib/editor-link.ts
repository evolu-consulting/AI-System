// CR-105 L4 · lối vào trình sửa quy trình ở ai-admin (admin-web `/processes`) qua SSO một lần, như `account-link`.
// Chỉ platform_admin sửa được (design.md §4) ⇒ chỉ họ thấy lối vào.
import { handOffUrl } from "@ai/web-kit/auth/sso";
import { session } from "~/features/auth/lib/session";
import { FALLBACK_URLS } from "~/features/shell/lib/fallback-urls";

export const FLOW_EDITOR_PATH = "/processes";
export const canEditFlow = (role: string | undefined): boolean => role === "platform_admin";

/** URL đích; `null` khi không xin được mã và cũng không có URL dự phòng. */
export function flowEditorUrl(): Promise<string | null> {
  return handOffUrl({
    authed: true,
    grant: () => session.ssoGrant("admin"),
    fallbackBase: FALLBACK_URLS.admin,
    next: FLOW_EDITOR_PATH,
  });
}

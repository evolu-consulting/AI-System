// CR-139d · lối vào «Chỉnh sơ đồ» ở ai-admin (tab Thành viên › Cơ cấu của công ty mình) qua SSO một lần, như `flowEditorUrl`.
// Quản trị công ty (tenant_admin) và platform_admin thấy nút; người khác chỉ xem.
import { handOffUrl } from "@ai/web-kit/auth/sso";
import { session } from "~/features/auth/lib/session";
import { FALLBACK_URLS } from "~/features/shell/lib/fallback-urls";

export const canEditOrg = (role: string | undefined): boolean =>
  role === "platform_admin" || role === "tenant_admin";

export const orgEditorPath = (tenantId: string): string =>
  `/tenants/${encodeURIComponent(tenantId)}?tab=members&view=org`;

/** URL đích; `null` khi không xin được mã và cũng không có URL dự phòng. */
export function orgEditorUrl(tenantId: string): Promise<string | null> {
  return handOffUrl({
    authed: true,
    grant: () => session.ssoGrant("admin"),
    fallbackBase: FALLBACK_URLS.admin,
    next: orgEditorPath(tenantId),
  });
}

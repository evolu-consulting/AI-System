// CR-112 · ADM-FR-76 · beforeLoad của route cũ (`/users`…): chuyển tới tab workspace công ty (tra mã → id khi platform_admin gửi `?tenant=`).
import { redirect } from "@tanstack/react-router";
import { queryClient } from "@/app/query-client";
import { tenantOptionsQuery } from "@/features/tenants/api";
import {
  type LegacyContext,
  type LegacyTab,
  legacyTarget,
  legacyTenantKey,
} from "@/features/tenants/lib/legacy-redirect";
import { session } from "@/lib/auth/session";
import { getLastTenant } from "@/lib/last-tenant";

export async function redirectLegacy(tab: LegacyTab, search: Record<string, unknown>) {
  const me = session.getState().me;
  const role = me?.role;
  let options: { id: string; key: string }[] = [];
  if (legacyTenantKey(role, search)) {
    options = await queryClient.ensureQueryData(tenantOptionsQuery).catch(() => []);
  }
  const ctx: LegacyContext = {
    role,
    ownTenantId: me?.tenant.id,
    lastTenantId: getLastTenant(),
    idForKey: (key) => options.find((o) => o.key === key)?.id,
  };
  const target = legacyTarget(tab, search, ctx);
  if (target.to === "/tenants") throw redirect({ to: "/tenants", replace: true });
  throw redirect({ ...target, replace: true });
}

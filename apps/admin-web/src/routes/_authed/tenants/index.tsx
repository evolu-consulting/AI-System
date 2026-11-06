import { createFileRoute, redirect } from "@tanstack/react-router";
import { TenantsPage } from "@/features/tenants/pages/TenantsPage";
import { session } from "@/lib/auth/session";

// CR-121 c10: sidebar "Công ty" trỏ /tenants; tenant_admin không có danh sách công ty ⇒ vào thẳng công ty MÌNH.
export const Route = createFileRoute("/_authed/tenants/")({
  beforeLoad: () => {
    const me = session.getState().me;
    if (me?.role === "tenant_admin" && me.tenant.id)
      throw redirect({
        to: "/tenants/$tenantId",
        params: { tenantId: me.tenant.id },
        replace: true,
      });
  },
  component: TenantsPage,
});

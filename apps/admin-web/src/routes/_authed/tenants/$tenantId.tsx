import { createFileRoute, redirect } from "@tanstack/react-router";
import {
  legacyTabRedirect,
  validateWorkspaceSearch,
} from "@/features/tenants/lib/workspace-search";
import { TenantDetailPage } from "@/features/tenants/pages/TenantDetailPage";
import { session } from "@/lib/auth/session";

// CR-112 · workspace công ty: `?tab=` + bộ lọc của các tab nhúng (Người dùng, Nhóm, Đối tác, Phân quyền).
export const Route = createFileRoute("/_authed/tenants/$tenantId")({
  validateSearch: validateWorkspaceSearch,
  // CR-121 R2 · c16: `?tab=workflow-tools` (tab đã gỡ) ⇒ Công cụ AI kèm thông báo.
  beforeLoad: ({ search, params }) => {
    const to = legacyTabRedirect(search, session.getState().me?.role);
    if (!to) return;
    if (to.to === "processes")
      throw redirect({
        to: "/tenants/$tenantId",
        params: { tenantId: params.tenantId },
        search: { tab: "processes" },
        replace: true,
      });
    throw redirect({ to: to.to, search: { notice: to.notice }, replace: true });
  },
  component: TenantDetailPage,
});

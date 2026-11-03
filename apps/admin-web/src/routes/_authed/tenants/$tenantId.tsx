import { createFileRoute } from "@tanstack/react-router";
import { validateWorkspaceSearch } from "@/features/tenants/lib/workspace-search";
import { TenantDetailPage } from "@/features/tenants/pages/TenantDetailPage";

// CR-112 · workspace công ty: `?tab=` + bộ lọc của các tab nhúng (Người dùng, Nhóm, Đối tác, Phân quyền).
export const Route = createFileRoute("/_authed/tenants/$tenantId")({
  validateSearch: validateWorkspaceSearch,
  component: TenantDetailPage,
});

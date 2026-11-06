// ADM-FR-65 · CR-056 · P-a: `/processes` — danh sách quy trình (PF4). Cờ off ⇒ NotFound (trong trang).
import { createFileRoute, redirect } from "@tanstack/react-router";
import {
  type LibFilter,
  parseLibFilter,
  parseSearchQ,
} from "@/features/processes/lib/library-filter";
import { ProcessesPage } from "@/features/processes/pages/ProcessesPage";
import { processesRedirectTenant } from "@/features/tenants/lib/legacy-redirect";
import { session } from "@/lib/auth/session";

/**
 * `app` (CR-118) + `slot`/`status`/`usedBy` (CR-120; c15 đổi `tenant` ⇒ `usedBy`) + `q` (ô tìm): bộ lọc thư viện, lưu ở URL; link từ trang cấu hình app dùng `app`.
 * `tenant` chỉ còn là URL CŨ (c13): `?tenant=<id>` chuyển tới Công ty › Quy trình, không phải bộ lọc.
 */
export type ProcessesSearch = {
  tab?: "own" | "templates";
  q?: string;
  tenant?: string;
} & LibFilter;

export const Route = createFileRoute("/_authed/processes/")({
  validateSearch: (s: Record<string, unknown>): ProcessesSearch => ({
    tab: s.tab === "templates" ? "templates" : s.tab === "own" ? "own" : undefined,
    ...parseLibFilter(s),
    ...(parseSearchQ(s.q) ? { q: parseSearchQ(s.q) } : {}),
    ...(typeof s.tenant === "string" ? { tenant: s.tenant } : {}),
  }),
  // CR-121 c13: không còn chỗ gán ở /processes ⇒ tenant_admin / `?tenant=<id>` chuyển tới Công ty › Quy trình.
  beforeLoad: ({ search }) => {
    const me = session.getState().me;
    const id = processesRedirectTenant(me?.role, search as Record<string, unknown>, me?.tenant.id);
    if (id)
      throw redirect({
        to: "/tenants/$tenantId",
        params: { tenantId: id },
        search: { tab: "processes" },
        replace: true,
      });
  },
  component: ProcessesPage,
});

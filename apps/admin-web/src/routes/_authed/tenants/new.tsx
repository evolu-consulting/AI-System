import { createFileRoute } from "@tanstack/react-router";
import { validateWizardSearch } from "@/features/tenants/lib/wizard";
import { TenantCreatePage } from "@/features/tenants/pages/TenantCreatePage";

// CR-112 · ADM-FR-79: wizard onboard; `?tenant=<id>&step=N` giữ trạng thái (resume, "Onboard lại" = step 2).
export const Route = createFileRoute("/_authed/tenants/new")({
  validateSearch: validateWizardSearch,
  component: TenantCreatePage,
});

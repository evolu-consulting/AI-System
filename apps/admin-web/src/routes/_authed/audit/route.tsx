import { createFileRoute } from "@tanstack/react-router";
import { validateAuditSearch } from "@/features/audit/lib/search";
import { AuditPage } from "@/features/audit/pages/AuditPage";

// `?tenant&entity&action&actor&from&to&q` — bộ lọc nằm trên URL; route con `$auditId` thừa hưởng search.
export const Route = createFileRoute("/_authed/audit")({
  validateSearch: validateAuditSearch,
  component: AuditPage,
});

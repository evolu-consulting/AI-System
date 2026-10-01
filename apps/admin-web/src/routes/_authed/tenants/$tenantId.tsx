import { createFileRoute } from "@tanstack/react-router";
import { TenantDetailPage } from "@/features/tenants/pages/TenantDetailPage";

export const Route = createFileRoute("/_authed/tenants/$tenantId")({ component: TenantDetailPage });

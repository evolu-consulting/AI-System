import { createFileRoute } from "@tanstack/react-router";
import { TenantsPage } from "@/features/tenants/pages/TenantsPage";

export const Route = createFileRoute("/_authed/tenants/")({ component: TenantsPage });

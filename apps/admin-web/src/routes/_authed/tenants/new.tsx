import { createFileRoute } from "@tanstack/react-router";
import { TenantCreatePage } from "@/features/tenants/pages/TenantCreatePage";

export const Route = createFileRoute("/_authed/tenants/new")({ component: TenantCreatePage });

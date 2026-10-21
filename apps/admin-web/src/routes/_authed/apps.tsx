import { createFileRoute } from "@tanstack/react-router";
import { AppsPage } from "@/features/apps/pages/AppsPage";

// app-catalog · /apps (chỉ platform_admin): danh mục app web cho switcher + đích SSO.
export const Route = createFileRoute("/_authed/apps")({ component: AppsPage });

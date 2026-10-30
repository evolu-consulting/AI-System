import { createFileRoute } from "@tanstack/react-router";
import { SystemPage } from "@/features/system/pages/SystemPage";

// CR-104 · ops-ui · /system "Tình trạng hệ thống" (chỉ platform_admin; vai khác thấy ForbiddenState từ PlatformOnly).
export const Route = createFileRoute("/_authed/system")({ component: SystemPage });

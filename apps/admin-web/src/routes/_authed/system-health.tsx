import { createFileRoute } from "@tanstack/react-router";
import { SystemPage } from "@/features/system/pages/SystemPage";

// CR-104 · ops-ui · /system-health "Tình trạng hệ thống" (chỉ platform_admin; vai khác thấy ForbiddenState từ PlatformOnly).
// CR-121 c22: chuyển từ /system (nay là hub "Hệ thống").
export const Route = createFileRoute("/_authed/system-health")({ component: SystemPage });

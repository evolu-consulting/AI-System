import { createFileRoute } from "@tanstack/react-router";
import { SystemHubPage } from "@/features/system/pages/SystemHubPage";

// CR-121 · c22 · /system "Hệ thống": hub lối vào (platform_admin thấy hết; tenant_admin: Chi phí · Nhật ký · Góp ý).
export const Route = createFileRoute("/_authed/system")({ component: SystemHubPage });

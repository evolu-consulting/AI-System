import { createFileRoute } from "@tanstack/react-router";
import { FeedbackPage } from "@/features/feedback/pages/FeedbackPage";

// feedback · /feedback (tenant_admin + platform_admin): góp ý của người dùng — lọc, đổi trạng thái, trả lời.
export const Route = createFileRoute("/_authed/feedback")({ component: FeedbackPage });

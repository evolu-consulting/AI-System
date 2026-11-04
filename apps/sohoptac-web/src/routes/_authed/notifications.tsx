// gap-c #13 · `/notifications`: trang "Tất cả thông báo" dùng chung (web-kit) — danh sách phân trang + form tùy chọn.
import { splitHref } from "@ai/web-kit/notify/href";
import { NotificationsPage } from "@ai/web-kit/ui/NotificationsPage";
import { createFileRoute, useNavigate } from "@tanstack/react-router";

function NotificationsRoute() {
  const navigate = useNavigate();
  return <NotificationsPage onNavigate={(href) => void navigate(splitHref(href) as { to: "/" })} />;
}

export const Route = createFileRoute("/_authed/notifications")({ component: NotificationsRoute });

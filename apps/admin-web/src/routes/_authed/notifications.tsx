// gap-c #13 · `/notifications`: trang "Tất cả thông báo" dùng chung (web-kit) — danh sách phân trang + form tùy chọn.
import { splitHref } from "@ai/web-kit/notify/href";
import { NotificationsPage } from "@ai/web-kit/ui/NotificationsPage";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { api } from "@/lib/http";

/** Client HTTP + phiên riêng của app (hằng module: giữ nguyên tham chiếu giữa các lần render). */
const TRANSPORT = { request: api };

function NotificationsRoute() {
  const navigate = useNavigate();
  return (
    <NotificationsPage
      transport={TRANSPORT}
      onNavigate={(href) => void navigate(splitHref(href) as { to: "/" })}
    />
  );
}

export const Route = createFileRoute("/_authed/notifications")({ component: NotificationsRoute });

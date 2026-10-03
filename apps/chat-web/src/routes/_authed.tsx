// CHAT-AC-01, CHAT-AC-03, CHAT-AC-04 · layout cần đăng nhập: tải trang → refresh cookie một lần; không có phiên → `/login?next=`.
import { createFileRoute } from "@tanstack/react-router";
import { requireSession } from "~/features/auth/lib/guard";
import { AuthedLayout } from "~/features/shell/components/AuthedLayout";

export const Route = createFileRoute("/_authed")({
  beforeLoad: ({ location }) => requireSession(location),
  component: AuthedLayout,
});

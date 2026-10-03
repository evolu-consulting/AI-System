// CHAT-AC-01, CHAT-AC-03, CHAT-AC-04, CHAT-AC-23 · layout (AppShell) cần đăng nhập: tải trang → refresh cookie một lần; không có phiên → `/login?next=`.
import { createFileRoute } from "@tanstack/react-router";
import { requireSession } from "~/features/auth/lib/guard";
import { AppShell } from "~/features/shell/components/AppShell";

export const Route = createFileRoute("/_authed")({
  beforeLoad: ({ location }) => requireSession(location),
  component: AppShell,
});

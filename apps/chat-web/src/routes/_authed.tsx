// CHAT-AC-01, CHAT-AC-03, CHAT-AC-04, CHAT-AC-23 · layout (AppShell) cần đăng nhập: tải trang → refresh cookie một lần; không có phiên → `/login?next=`.
// app-perm · công ty không dùng Chat AI (thu hồi `chat-app`) ⇒ về `/` (chuyển phiên sang app của họ), không báo lỗi.
import { createFileRoute, redirect } from "@tanstack/react-router";
import { requireSession } from "~/features/auth/lib/guard";
import { chatDenied } from "~/features/portal/lib/landing";
import { AppShell } from "~/features/shell/components/AppShell";
import { session } from "~/lib/auth/session";

export const Route = createFileRoute("/_authed")({
  beforeLoad: async ({ location }) => {
    await requireSession(location);
    const me = session.getState().me;
    if (me && (await chatDenied(me.id))) throw redirect({ to: "/" });
  },
  component: AppShell,
});

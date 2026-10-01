import { createFileRoute, redirect } from "@tanstack/react-router";
import { ForcedPasswordPage } from "@/features/auth/pages/ForcedPasswordPage";
import { session } from "@/lib/auth/session";

export const Route = createFileRoute("/change-password")({
  // Không có change_token trong bộ nhớ (tải lại trang, vào thẳng URL) → về đăng nhập.
  beforeLoad: () => {
    if (!session.getState().pendingChange) throw redirect({ to: "/login", search: {} });
  },
  component: ForcedPasswordPage,
});

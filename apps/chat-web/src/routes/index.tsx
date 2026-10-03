// C1 FE · `/` → `/c/new` (guard `_authed` lo phần chưa đăng nhập).
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  beforeLoad: () => {
    throw redirect({ to: "/c/new" });
  },
});

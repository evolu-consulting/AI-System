// W1 · nav-v2: /my-work — "Việc của tôi" nay là khối "Cần xử lý" của Tổng quan; đường cũ chuyển hướng.
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authed/my-work")({
  beforeLoad: () => {
    throw redirect({ to: "/overview", replace: true });
  },
});

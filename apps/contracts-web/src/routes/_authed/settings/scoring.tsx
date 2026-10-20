// V2-O · /settings/scoring đã thay bằng hộp thoại Cài đặt (Điểm uy tín) — chuyển hướng về Đối tác.
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authed/settings/scoring")({
  beforeLoad: () => {
    throw redirect({ to: "/partners", replace: true });
  },
});

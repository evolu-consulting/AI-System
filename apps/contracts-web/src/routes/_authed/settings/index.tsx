// V2-O · /settings: Cài đặt mở bằng hộp thoại từ avatar; trang này chỉ còn là đường vào Thành viên & phòng ban — chuyển hướng.
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authed/settings/")({
  beforeLoad: () => {
    throw redirect({ to: "/settings/members", replace: true });
  },
});

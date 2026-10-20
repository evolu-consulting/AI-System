// V2-O · /cks đã thay bằng "khách đang dùng" của Sản phẩm — chuyển hướng.
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authed/cks/")({
  beforeLoad: () => {
    throw redirect({ to: "/products", replace: true });
  },
});

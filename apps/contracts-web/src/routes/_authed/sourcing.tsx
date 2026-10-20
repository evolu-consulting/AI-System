// V2-O · /sourcing đã gộp vào Hợp đồng (chi tiết) và Sản phẩm — chuyển hướng.
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authed/sourcing")({
  beforeLoad: () => {
    throw redirect({ to: "/products", replace: true });
  },
});

// V2-O · /prices đã gộp vào chi tiết SP (tab NCC & giá) — chuyển hướng.
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authed/prices")({
  beforeLoad: () => {
    throw redirect({ to: "/products", replace: true });
  },
});

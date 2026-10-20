// W1 · nav-v2: /sourcing → tab "Mua hàng" của /products.
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authed/sourcing")({
  beforeLoad: () => {
    throw redirect({ to: "/products", search: { tab: "sourcing" }, replace: true });
  },
});

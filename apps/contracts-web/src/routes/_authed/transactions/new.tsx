// DOC-ui-list: G2 gỡ — `/transactions/new` chuyển hướng sang form Giao dịch dùng chung.
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authed/transactions/new")({
  beforeLoad: () => {
    throw redirect({ to: "/contracts/new", search: { type: "deal" }, replace: true });
  },
});

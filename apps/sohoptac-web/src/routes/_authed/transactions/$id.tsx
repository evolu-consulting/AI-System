// DOC-ui-list: G2 gỡ — `/transactions/$id` chuyển hướng sang chi tiết chứng từ cùng id (lớp tương thích `/transactions` trả id chứng từ).
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authed/transactions/$id")({
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/contracts/$id", params: { id: params.id }, replace: true });
  },
});

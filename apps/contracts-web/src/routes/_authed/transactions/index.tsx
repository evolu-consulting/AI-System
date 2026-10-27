// DOC-ui-list: G2 gỡ — `/transactions` chuyển hướng sang danh sách "Hợp đồng & giao dịch" lọc Giao dịch (giao dịch là chứng từ `deal`).
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authed/transactions/")({
  beforeLoad: () => {
    throw redirect({ to: "/contracts", search: { type: "deal" }, replace: true });
  },
});

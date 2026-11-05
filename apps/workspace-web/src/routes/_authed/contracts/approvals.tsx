// CR-121 C-7 · route /contracts/approvals — "Chờ tôi duyệt" (HĐ có bước duyệt đang chờ người xem).
import { createFileRoute } from "@tanstack/react-router";
import { ApprovalsInboxPage } from "~/features/overview/pages/ApprovalsInboxPage";

export const Route = createFileRoute("/_authed/contracts/approvals")({
  component: ApprovalsInboxPage,
});

// CR-124 · q4 · route /contracts/partner-inbox — hộp «Hợp đồng đối tác gửi» (mục riêng ở thanh trái app Hợp đồng).
import { createFileRoute } from "@tanstack/react-router";
import { PartnerInboxPage } from "~/features/partner-inbox/pages/PartnerInboxPage";

export const Route = createFileRoute("/_authed/contracts/partner-inbox")({
  component: PartnerInboxPage,
});

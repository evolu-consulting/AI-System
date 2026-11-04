// PK-FR-10 · HD8-FR-01 · V2-I · route /partners — danh sách đối tác (điểm từng vai); `?party=` mở trang chi tiết (tab, vai, khoảng biểu đồ).
import { createFileRoute } from "@tanstack/react-router";
import { parsePartnersSearch } from "~/features/partners/lib/partner-v2";
import { PartnersRoutePage } from "~/features/partners/pages/PartnersRoutePage";

export const Route = createFileRoute("/_authed/partners")({
  validateSearch: parsePartnersSearch,
  component: PartnersRoutePage,
});

// CR-139 · Q13 · route /contracts/org — «Sơ đồ tổ chức» (chỉ xem).
import { createFileRoute } from "@tanstack/react-router";
import { OrgChartPage } from "~/features/org-chart/pages/OrgChartPage";

export const Route = createFileRoute("/_authed/contracts/org")({
  component: OrgChartPage,
});

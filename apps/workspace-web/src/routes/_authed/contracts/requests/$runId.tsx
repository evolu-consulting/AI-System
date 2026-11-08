// CR-125 · cr125-manual-start-ui · /contracts/requests/$runId — trang một yêu cầu (trạng thái + phiếu + việc của tôi).
import { createFileRoute } from "@tanstack/react-router";
import { RequestPage } from "~/features/requests/pages/RequestPage";

type Search = { sent?: "new" | "again" };

function RequestRoute() {
  const { runId } = Route.useParams();
  const { sent } = Route.useSearch();
  return <RequestPage runId={runId} sent={sent} />;
}

export const Route = createFileRoute("/_authed/contracts/requests/$runId")({
  validateSearch: (s: Record<string, unknown>): Search =>
    s.sent === "new" || s.sent === "again" ? { sent: s.sent } : {},
  component: RequestRoute,
});

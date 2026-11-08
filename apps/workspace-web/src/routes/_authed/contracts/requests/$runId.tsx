// CR-125 · cr125-manual-start-ui · /contracts/requests/$runId — trang một yêu cầu (trạng thái + phiếu + các bước + việc của tôi).
// `focus` = mã lượt con cần nhìn vào (mở từ «Chờ tôi duyệt» của Quy trình con).
import { createFileRoute } from "@tanstack/react-router";
import { RequestPage } from "~/features/requests/pages/RequestPage";

type Search = { sent?: "new" | "again"; focus?: string };

function RequestRoute() {
  const { runId } = Route.useParams();
  const { sent, focus } = Route.useSearch();
  return <RequestPage runId={runId} sent={sent} focus={focus} />;
}

export const Route = createFileRoute("/_authed/contracts/requests/$runId")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    ...(s.sent === "new" || s.sent === "again" ? { sent: s.sent } : {}),
    ...(typeof s.focus === "string" && /^[0-9a-f-]{36}$/i.test(s.focus) ? { focus: s.focus } : {}),
  }),
  component: RequestRoute,
});

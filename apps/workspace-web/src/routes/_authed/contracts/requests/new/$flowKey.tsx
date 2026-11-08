// CR-125 · cr125-manual-start-ui · /contracts/requests/new/$flowKey — phiếu yêu cầu của một loại quy trình.
import { createFileRoute } from "@tanstack/react-router";
import { NewRequestPage } from "~/features/requests/pages/NewRequestPage";

function NewRoute() {
  const { flowKey } = Route.useParams();
  return <NewRequestPage flowKey={flowKey} />;
}

export const Route = createFileRoute("/_authed/contracts/requests/new/$flowKey")({
  component: NewRoute,
});

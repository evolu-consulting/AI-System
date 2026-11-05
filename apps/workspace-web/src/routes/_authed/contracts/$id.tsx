// PK-FR-10 · HD-FR-26 · S05: /contracts/$id — màn kiểm/sửa hợp đồng (HD2).
import { createFileRoute } from "@tanstack/react-router";
import { ContractReviewPage } from "~/features/contract-review/pages/ContractReviewPage";

function ContractRoute() {
  const { id } = Route.useParams();
  return <ContractReviewPage id={id} />;
}

export const Route = createFileRoute("/_authed/contracts/$id")({ component: ContractRoute });

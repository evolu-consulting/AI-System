// CR-097 G2 · GD-FR-01…05: /transactions/$id — chi tiết giao dịch (nháp sửa được; đã ghi sổ: mô tả/điều chỉnh/huỷ).
import { createFileRoute } from "@tanstack/react-router";
import { TransactionDetailPage } from "~/features/transactions/pages/TransactionDetailPage";

function TransactionRoute() {
  const { id } = Route.useParams();
  return <TransactionDetailPage id={id} />;
}

export const Route = createFileRoute("/_authed/transactions/$id")({ component: TransactionRoute });

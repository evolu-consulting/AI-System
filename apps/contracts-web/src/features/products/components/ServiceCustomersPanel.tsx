// V2-H · SP-03: nội dung tab "Khách đang dùng" trong chi tiết SP của V2-J1 (chỗ gắn `lib/slots.ts`, `?ht=users`).
import { ErrorLine, Loading } from "~/components/shared/states";
import { useServiceCustomers } from "../hooks/use-service-customers";
import { ServiceCustomersTab } from "./ServiceCustomersTab";

export function ServiceCustomersPanel({ productId }: { productId: string }) {
  const q = useServiceCustomers(productId);
  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorLine error={q.error} />;
  return (
    <div role="tabpanel" className="p-4">
      <ServiceCustomersTab data={q.data} />
    </div>
  );
}

// CR-122 · U2 · tab "Quy trình" của công ty — MỘT danh sách flow (`company_flows`) thay "việc → quy trình → luật" của CR-121.
// platform_admin + tenant_admin công ty mình.
import { ErrorState } from "@/components/shared/states/ErrorState";
import { LoadingState } from "@/components/shared/states/LoadingState";
import { ApiError } from "@/lib/http";
import { useCompanyFlowList } from "../company-flows-api";
import { CompanyFlowList } from "./CompanyFlowList";

export default function CompanyFlowsTab({
  tenant,
}: {
  tenant: { id: string; name: string };
  /** Còn nhận từ dải "Cần xử lý" của tab Ứng dụng; danh sách mới không còn ngăn Gán theo việc nên bỏ qua. */
  initialJob?: string | undefined;
}) {
  const q = useCompanyFlowList(tenant.id);
  if (q.isPending) return <LoadingState />;
  if (q.isError) {
    const e = q.error instanceof ApiError ? q.error : null;
    return (
      <ErrorState
        message={e?.message ?? ""}
        code={e?.code ?? "NETWORK_ERROR"}
        onRetry={() => void q.refetch()}
      />
    );
  }
  const rows = q.data.items;
  return (
    <div className="space-y-4" data-testid="company-flows">
      <CompanyFlowList tenantId={tenant.id} rows={rows} />
    </div>
  );
}

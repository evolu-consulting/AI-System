// ADM-FR-42 · usage-analytics · mức dùng so với quota THÁNG NÀY (dữ liệu báo cáo `/admin/usage` của M4, page truyền vào):
// một tenant ⇒ thẻ quota; platform không chọn tenant ⇒ bảng theo tenant (% quota, mức cảnh báo).
import { ByTenantTable } from "@/features/usage/components/ByTenantTable";
import { QuotaCard } from "@/features/usage/components/QuotaCard";
import type { UsageReport } from "@/features/usage/lib/types";

type Err = { message: string; code: string; onRetry?: () => void };
type Props = {
  report: UsageReport | undefined;
  platformAll: boolean;
  loading?: boolean;
  error?: Err;
};

export function QuotaSection({ report, platformAll, loading, error }: Props) {
  if (platformAll)
    return (
      <ByTenantTable
        rows={report && "tenants" in report ? report.tenants : undefined}
        loading={loading}
        error={error}
      />
    );
  return <QuotaCard quotas={report?.quotas} loading={loading} error={error} />;
}

// ADM-FR-41 · M4-R06 · card "Quota tháng": QuotaBar cả tenant (Run/Token/USD) + link "Xem chi phí & quota". Giới hạn trống → "Không giới hạn".
import type { QuotaStatus } from "@ai/contracts";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { QuotaBar } from "@/components/shared/quota/QuotaBar";
import type { LoadError } from "@/lib/load-error";
import { Panel } from "./Panel";

type Props = {
  quotas: QuotaStatus[] | undefined;
  loading?: boolean;
  error?: (LoadError & { onRetry?: () => void }) | null;
};

export function TenantQuotaCard({ quotas, loading, error }: Props) {
  const { t } = useTranslation();
  const row = quotas?.find((q) => q.feature_id === null);
  return (
    <Panel
      title={t("overview.kpi.quota")}
      loading={loading}
      error={error}
      footer={
        <Link to={"/usage" as "/"} className="font-medium text-primary hover:underline">
          {t("overview.quota.link")}
        </Link>
      }
    >
      {row ? (
        <div className="space-y-3">
          <QuotaBar label="Run" kind="runs" used={row.used.runs} limit={row.max_runs} />
          <QuotaBar label="Token" kind="tokens" used={row.used.tokens} limit={row.max_tokens} />
          <QuotaBar label="USD" kind="usd" used={row.used.billable_usd} limit={row.max_usd} />
        </div>
      ) : (
        <p className="text-body text-muted-foreground">{t("overview.quota.empty")}</p>
      )}
    </Panel>
  );
}

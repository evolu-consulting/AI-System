// ADM-FR-42 · M4-R02, R06 · card "Quota tháng" (một tenant / tenant_admin): QuotaBar Run · Token · USD cho cả tenant, rồi từng feature có quota.
import type { QuotaStatus } from "@ai/contracts";
import { useTranslation } from "react-i18next";
import { QuotaBar } from "@/components/shared/quota/QuotaBar";
import { Panel } from "@/features/overview/components/Panel";
import { pickLocalized } from "@/lib/localized";

type Props = {
  quotas: QuotaStatus[] | undefined;
  loading?: boolean;
  error?: { message: string; code: string; onRetry?: () => void };
};

function Bars({ q, scope }: { q: QuotaStatus; scope: string | null }) {
  const suffix = scope ? ` · ${scope}` : "";
  return (
    <div className="space-y-3">
      {q.max_runs !== null || !scope ? (
        <QuotaBar label={`Run${suffix}`} kind="runs" used={q.used.runs} limit={q.max_runs} />
      ) : null}
      {q.max_tokens !== null || !scope ? (
        <QuotaBar
          label={`Token${suffix}`}
          kind="tokens"
          used={q.used.tokens}
          limit={q.max_tokens}
        />
      ) : null}
      {q.max_usd !== null || !scope ? (
        <QuotaBar label={`USD${suffix}`} kind="usd" used={q.used.billable_usd} limit={q.max_usd} />
      ) : null}
    </div>
  );
}

export function QuotaCard({ quotas, loading, error }: Props) {
  const { t, i18n } = useTranslation();
  const whole = quotas?.find((q) => q.feature_id === null);
  const features = (quotas ?? []).filter((q) => q.feature_id !== null);
  return (
    <Panel title={t("usage.quotaCard")} loading={loading} error={error}>
      <div className="space-y-4">
        {whole ? <Bars q={whole} scope={null} /> : null}
        {features.map((q) => (
          <Bars
            key={q.feature_id}
            q={q}
            scope={
              q.feature_name ? pickLocalized(q.feature_name, i18n.language) : (q.feature_key ?? "")
            }
          />
        ))}
      </div>
    </Panel>
  );
}

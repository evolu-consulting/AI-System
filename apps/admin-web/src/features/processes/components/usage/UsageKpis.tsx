// ADM-FR-67 · P-a F5: KPI tổng (Tổng token · Vào · Ra · Cache · Lượt gọi).
import type { TokenTotals } from "@ai/contracts/chat";
import { memo } from "react";
import { useTranslation } from "react-i18next";
import { cacheOf, formatTokens } from "../../lib/usage-view";

export const UsageKpis = memo(function UsageKpis({ totals }: { totals: TokenTotals }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const items = [
    ["total", totals.total, "process-total-tokens"],
    ["in", totals.input, undefined],
    ["out", totals.output, undefined],
    ["cache", cacheOf(totals), undefined],
    ["calls", totals.calls, undefined],
  ] as const;
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
      {items.map(([k, n, testId]) => (
        <div key={k} className="rounded-lg border border-border bg-card px-3 py-2">
          <dt className="text-caption text-muted-foreground">{t(`process.usage.kpi.${k}`)}</dt>
          <dd className="text-card-title font-semibold tabular-nums" data-testid={testId}>
            {formatTokens(n, lang)}
          </dd>
        </div>
      ))}
    </dl>
  );
});

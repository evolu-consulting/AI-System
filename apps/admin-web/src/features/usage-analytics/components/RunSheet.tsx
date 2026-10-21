// ADM-FR-42 · usage-analytics · drill-down một run: mọi lời gọi AI của run (agent, model, kết quả, token, độ trễ, chi phí)
// + tổng. Mở từ bảng bản ghi; dữ liệu do page truyền (chỉ trình bày).
import type { UsageRun } from "@ai/contracts";
import { useTranslation } from "react-i18next";
import { ErrorState } from "@/components/shared/states/ErrorState";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCount, formatUsd } from "@/lib/quota-format";
import { useAppLabel } from "./labels";
import { OutcomeBadge } from "./RecordsPanel";

type Props = {
  runId: string | null;
  data: UsageRun | undefined;
  loading?: boolean;
  error?: { message: string; code: string; onRetry?: () => void };
  onClose: () => void;
};

function Totals({ d }: { d: UsageRun }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const cells: [string, string][] = [
    ["tokens", formatCount(d.total.tokens, lang)],
    ["calls", formatCount(d.total.calls, lang)],
    ["errors", formatCount(d.total.errors, lang)],
  ];
  if (d.total.cost_usd !== undefined) cells.push(["cost", formatUsd(d.total.cost_usd, lang)]);
  return (
    <dl className="grid grid-cols-2 gap-3 text-label sm:grid-cols-4">
      {cells.map(([k, v]) => (
        <div key={k} className="rounded-lg border p-3">
          <dt className="text-caption text-muted-foreground">
            {t(`usageAnalytics.col.${k}` as "usageAnalytics.col.tokens")}
          </dt>
          <dd className="font-semibold tabular-nums">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function RunSheet({ runId, data, loading, error, onClose }: Props) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const appLabel = useAppLabel();
  return (
    <Sheet open={runId !== null} onOpenChange={(o) => (o ? undefined : onClose())}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>{t("usageAnalytics.run.title")}</SheetTitle>
          <SheetDescription className="font-mono">{runId}</SheetDescription>
        </SheetHeader>
        <div className="space-y-4 px-4 pb-4">
          {error ? <ErrorState {...error} /> : null}
          {loading ? <Skeleton className="h-24 w-full" /> : null}
          {data ? (
            <>
              <Totals d={data} />
              <ol className="space-y-2">
                {data.items.map((r) => (
                  <li key={r.id} className="rounded-lg border p-3 text-label">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="tabular-nums text-muted-foreground">
                        {new Date(r.at).toLocaleTimeString(lang)}
                      </span>
                      <span className="font-medium">
                        {r.agent_key ?? r.feature ?? appLabel(r.app)}
                      </span>
                      <span className="font-mono text-caption">{r.model ?? "—"}</span>
                      <OutcomeBadge o={r.outcome} />
                    </div>
                    <p className="mt-1 tabular-nums text-muted-foreground">
                      {t("usageAnalytics.run.line", {
                        input: formatCount(r.input_tokens, lang),
                        output: formatCount(r.output_tokens, lang),
                        cache: formatCount(r.cache_read_tokens + r.cache_write_tokens, lang),
                        ms: r.latency_ms === null ? "—" : formatCount(r.latency_ms, lang),
                      })}
                      {r.cost_usd ? ` · ${formatUsd(r.cost_usd, lang)}` : ""}
                    </p>
                  </li>
                ))}
              </ol>
            </>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

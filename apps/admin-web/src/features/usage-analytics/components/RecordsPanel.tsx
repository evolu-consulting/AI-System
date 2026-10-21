// ADM-FR-42 · usage-analytics · bảng bản ghi usage thô (cùng bộ lọc): thời điểm, tenant, user, app, tính năng, agent, model,
// kết quả, token vào/ra, độ trễ, chi phí (platform). Trước/Sau (keyset), xuất CSV, bấm run ⇒ chi tiết run. Chỉ trình bày.
import type { UsageRecord } from "@ai/contracts";
import { Download } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Panel } from "@/components/shared/panel/Panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatCount, formatUsd } from "@/lib/quota-format";
import { useAppLabel } from "./labels";

const OUTCOME = { ok: "ok", error: "err", cancelled: "off" } as const;

export function OutcomeBadge({ o }: { o: UsageRecord["outcome"] }) {
  const { t } = useTranslation();
  if (o === null) return <span className="text-muted-foreground">—</span>;
  return <Badge variant={OUTCOME[o]}>{t(`usageAnalytics.outcome.${o}`)}</Badge>;
}

const td = "py-1.5 pr-3";
const mono = `${td} font-mono text-caption`;
const num = `${td} tabular-nums`;

function Row({ r, onRun }: { r: UsageRecord; onRun: (id: string) => void }) {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const appLabel = useAppLabel();
  const run = r.run_id;
  return (
    <tr className="border-t">
      <td className={`${num} whitespace-nowrap`}>{new Date(r.at).toLocaleString(lang)}</td>
      <td className={mono}>{r.tenant_key}</td>
      <td className={td}>{r.username ?? "—"}</td>
      <td className={td}>{appLabel(r.app)}</td>
      <td className={mono}>{r.feature ?? "—"}</td>
      <td className={td}>{r.agent_key ?? "—"}</td>
      <td className={mono}>{r.model ?? "—"}</td>
      <td className={td}>
        <OutcomeBadge o={r.outcome} />
      </td>
      <td className={num}>{formatCount(r.input_tokens, lang)}</td>
      <td className={num}>{formatCount(r.output_tokens, lang)}</td>
      <td className={num}>
        {r.latency_ms === null ? "—" : `${formatCount(r.latency_ms, lang)} ms`}
      </td>
      {r.cost_usd !== undefined ? (
        <td className={num}>{r.cost_usd === null ? "—" : formatUsd(r.cost_usd, lang)}</td>
      ) : null}
      <td className="py-1.5">
        {run ? (
          <button
            type="button"
            className="font-mono text-caption text-primary hover:underline"
            onClick={() => onRun(run)}
          >
            {run.slice(0, 8)}
          </button>
        ) : (
          "—"
        )}
      </td>
    </tr>
  );
}

const COLS = [
  "at",
  "tenant",
  "user",
  "app",
  "feature",
  "agent",
  "model",
  "outcome",
  "input",
  "output",
  "latency",
];

type Props = {
  items: UsageRecord[] | undefined;
  platform: boolean;
  loading?: boolean;
  error?: { message: string; code: string; onRetry?: () => void };
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  onCsv: () => void;
  csvPending: boolean;
  onRun: (id: string) => void;
};

export function RecordsPanel(p: Props) {
  const { t } = useTranslation();
  const cols = [...COLS, ...(p.platform ? ["cost"] : []), "run"];
  const items = p.items ?? [];
  return (
    <Panel title={t("usageAnalytics.records.title")} loading={p.loading} error={p.error}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-caption text-muted-foreground">{t("usageAnalytics.records.note")}</p>
        <Button type="button" variant="outline" size="sm" disabled={p.csvPending} onClick={p.onCsv}>
          <Download aria-hidden className="size-4" />
          {t("usage.csv")}
        </Button>
      </div>
      {items.length === 0 ? (
        <p className="text-body text-muted-foreground">{t("usageAnalytics.empty")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table aria-label={t("usageAnalytics.records.title")} className="w-full text-label">
            <thead>
              <tr className="text-left text-caption text-muted-foreground">
                {cols.map((c) => (
                  <th key={c} scope="col" className="pb-2 pr-3 font-medium whitespace-nowrap">
                    {t(`usageAnalytics.rcol.${c}` as "usageAnalytics.rcol.at")}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((r) => (
                <Row key={r.id} r={r} onRun={p.onRun} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-3 flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" disabled={!p.hasPrev} onClick={p.onPrev}>
          {t("usageAnalytics.records.prev")}
        </Button>
        <Button type="button" variant="outline" size="sm" disabled={!p.hasNext} onClick={p.onNext}>
          {t("usageAnalytics.records.next")}
        </Button>
      </div>
    </Panel>
  );
}

// ADM-FR-42 · usage-analytics · bảng "Token đổ vào đâu": app → agent (hoặc tính năng khi gọi AI trực tiếp) → model, kèm %,
// lượt gọi, lỗi, chi phí. Nhóm theo app (dòng tổng app in đậm), trong app giảm dần theo token.
import type { UsageTreeRow } from "@ai/contracts";
import { Fragment } from "react";
import { useTranslation } from "react-i18next";
import { Panel } from "@/components/shared/panel/Panel";
import { Badge } from "@/components/ui/badge";
import { formatCount, formatUsd } from "@/lib/quota-format";
import { sharePct } from "../lib/view";
import { useAppLabel, useTierLabel } from "./labels";

type Err = { message: string; code: string; onRetry?: () => void };
type Props = { rows: UsageTreeRow[] | undefined; loading?: boolean; error?: Err };

function groups(rows: readonly UsageTreeRow[]) {
  const by = new Map<string, UsageTreeRow[]>();
  for (const r of rows) by.set(r.app, [...(by.get(r.app) ?? []), r]);
  return [...by]
    .map(([app, list]) => ({ app, list, tokens: list.reduce((s, r) => s + r.tokens, 0) }))
    .sort((a, b) => b.tokens - a.tokens);
}

export function FlowTable({ rows, loading, error }: Props) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const appLabel = useAppLabel();
  const tierLabel = useTierLabel();
  const g = groups(rows ?? []);
  const total = g.reduce((s, x) => s + x.tokens, 0);
  const cost = rows?.some((r) => r.cost_usd !== undefined) ?? false;
  const cols = ["agent", "model", "tokens", "share", "calls", "errors", ...(cost ? ["cost"] : [])];
  return (
    <Panel title={t("usageAnalytics.flow.title")} loading={loading} error={error}>
      {g.length === 0 ? (
        <p className="text-body text-muted-foreground">{t("usageAnalytics.empty")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table aria-label={t("usageAnalytics.flow.title")} className="w-full text-label">
            <thead>
              <tr className="text-left text-caption text-muted-foreground">
                {cols.map((c) => (
                  <th key={c} scope="col" className="pb-2 pr-3 font-medium">
                    {t(`usageAnalytics.col.${c}` as "usageAnalytics.col.agent")}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {g.map((grp) => (
                <Fragment key={grp.app}>
                  <tr className="border-t bg-muted/40">
                    <th scope="rowgroup" colSpan={2} className="py-2 pr-3 text-left font-semibold">
                      {appLabel(grp.app)}
                    </th>
                    <td className="py-2 pr-3 font-semibold tabular-nums">
                      {formatCount(grp.tokens, lang)}
                    </td>
                    <td className="py-2 pr-3 tabular-nums">{sharePct(grp.tokens, total)}%</td>
                    <td colSpan={cols.length - 4} />
                  </tr>
                  {grp.list.map((r) => (
                    <tr key={`${r.agent_id}|${r.feature}|${r.model}`} className="border-t">
                      <th scope="row" className="py-1.5 pl-4 pr-3 text-left font-normal">
                        {r.agent_key ?? r.feature ?? t("usageAnalytics.none")}
                        {r.agent_key && r.feature ? (
                          <span className="ml-1 text-caption text-muted-foreground">
                            {r.feature}
                          </span>
                        ) : null}
                      </th>
                      <td className="py-1.5 pr-3">
                        <span className="font-mono text-caption">{r.model ?? "—"}</span>{" "}
                        <Badge variant="outline">{tierLabel(r.tier)}</Badge>
                      </td>
                      <td className="py-1.5 pr-3 tabular-nums">{formatCount(r.tokens, lang)}</td>
                      <td className="py-1.5 pr-3 tabular-nums">{sharePct(r.tokens, total)}%</td>
                      <td className="py-1.5 pr-3 tabular-nums">{formatCount(r.calls, lang)}</td>
                      <td className="py-1.5 pr-3 tabular-nums">{formatCount(r.errors, lang)}</td>
                      {cost ? (
                        <td className="py-1.5 pr-3 tabular-nums">
                          {formatUsd(r.cost_usd ?? "0", lang)}
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

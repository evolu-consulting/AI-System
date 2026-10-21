// ADM-FR-42 · usage-analytics · một breakdown "token đổ vào đâu" dạng thanh ngang: nhãn, thanh tỉ lệ, token, % tổng, lượt
// gọi, chi phí (khi có). Bấm một dòng ⇒ lọc theo khoá đó (nếu chiều lọc được).
import type { UsageBreakdownRow } from "@ai/contracts";
import { useTranslation } from "react-i18next";
import { Panel } from "@/components/shared/panel/Panel";
import { formatCount, formatUsd } from "@/lib/quota-format";
import { colorAt, sharePct } from "../lib/view";

type Err = { message: string; code: string; onRetry?: () => void };
type Props = {
  title: string;
  rows: UsageBreakdownRow[] | undefined;
  /** Nhãn hiển thị của khoá (app/tier dịch; mặc định `label`). */
  label?: (r: UsageBreakdownRow) => string;
  /** Lọc theo khoá; vắng ⇒ dòng không bấm được. */
  onPick?: (key: string) => void;
  loading?: boolean;
  error?: Err;
  max?: number;
};

export function BreakdownPanel({ title, rows, label, onPick, loading, error, max = 10 }: Props) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const list = (rows ?? []).slice(0, max);
  const total = (rows ?? []).reduce((s, r) => s + r.tokens, 0);
  const top = list[0]?.tokens ?? 0;
  const name = (r: UsageBreakdownRow) => (label ? label(r) : (r.label ?? t("usageAnalytics.none")));
  return (
    <Panel title={title} loading={loading} error={error}>
      {list.length === 0 ? (
        <p className="text-body text-muted-foreground">{t("usageAnalytics.empty")}</p>
      ) : (
        <ul className="space-y-2.5">
          {list.map((r, i) => {
            const content = (
              <>
                <span className="flex items-baseline justify-between gap-2 text-label">
                  <span className="truncate font-medium">{name(r)}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {formatCount(r.tokens, lang)} · {sharePct(r.tokens, total)}%
                    {r.cost_usd !== undefined ? ` · ${formatUsd(r.cost_usd, lang)}` : ""}
                  </span>
                </span>
                <span aria-hidden className="mt-1 block h-1.5 rounded-full bg-muted">
                  <span
                    className="block h-1.5 rounded-full"
                    style={{
                      width: `${top ? (r.tokens / top) * 100 : 0}%`,
                      background: colorAt(i),
                    }}
                  />
                </span>
              </>
            );
            return (
              <li key={r.key ?? "none"}>
                {onPick && r.key !== null ? (
                  <button
                    type="button"
                    className="block w-full rounded-sm text-left hover:bg-muted/50"
                    title={t("usageAnalytics.pick", { name: name(r) })}
                    onClick={() => onPick(r.key as string)}
                  >
                    {content}
                  </button>
                ) : (
                  content
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

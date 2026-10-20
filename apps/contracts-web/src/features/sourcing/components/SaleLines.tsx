// W1 · bảng dòng đang bán: nguồn mua (chọn tay nếu có quyền ghi), giá mua, lãi, rủi ro (port cm-web `sourcing/Lines.tsx`).
import type { SaleLine, SourceRef } from "@ai/contracts";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { viDate, vnd } from "~/components/shared/format";
import { cn } from "~/lib/utils";
import { useChooseSource } from "../hooks/use-sourcing";
import { RISK_TONE, refKey, selectValue, sourcingErrorText } from "../lib/sourcing";

const th =
  "px-4 py-3 text-left text-xs font-semibold text-dim whitespace-nowrap sticky top-0 z-10 bg-sunk";
const td = "px-4 py-3 border-t border-rule-soft";
const money = (n: number | null) =>
  n == null ? (
    <span className="text-dim">—</span>
  ) : (
    <span className="tnum font-mono">{vnd(n)}</span>
  );

function label(c: SourceRef, t: (k: string) => string): string {
  return `${c.supplier.name ?? "—"} · ${c.number ?? "HĐ"} · ${vnd(c.price)} đ${c.current ? "" : ` (${t("contracts.sourcing.ended")})`}`;
}

/** Ô "Mua từ": ô chọn nguồn (chỉ người có quyền ghi và khi có ứng viên) + nguồn đang dùng. */
function SourceCell({
  r,
  options,
  busy,
  onPick,
}: {
  r: SaleLine;
  options: SourceRef[];
  busy: boolean;
  onPick: (value: string) => void;
}) {
  const { t } = useTranslation();
  const s = r.source;
  return (
    <>
      {options.length > 0 && (
        <select
          aria-label={t("contracts.sourcing.sourceOf", { name: r.name })}
          disabled={busy}
          className="field h-9 max-w-[320px] text-[13px]"
          value={selectValue(r)}
          onChange={(e) => onPick(e.target.value)}
        >
          <option value="">{t("contracts.sourcing.auto")}</option>
          {options.map((c) => (
            <option key={refKey(c)} value={refKey(c)}>
              {label(c, t)}
            </option>
          ))}
        </select>
      )}
      {s ? (
        <span className="mt-1 block text-dim">
          {s.supplier.name ?? "—"} ·{" "}
          <Link
            to="/contracts/$id"
            params={{ id: s.contract_id }}
            className="text-act hover:underline"
          >
            {s.number ?? "HĐ"}
          </Link>
          {s.end_date && <> · {t("contracts.sourcing.endsOn", { date: viDate(s.end_date) })}</>}
        </span>
      ) : (
        <span className="text-dim">{t("contracts.sourcing.noSource")}</span>
      )}
    </>
  );
}
export function SaleLines({
  rows,
  candidates,
  write,
  showContract = true,
}: {
  rows: SaleLine[];
  candidates: Record<string, SourceRef[]>;
  write: boolean;
  /** Cột "HĐ bán · khách hàng" (ẩn trên trang chi tiết HĐ bán, như cm-web). */
  showContract?: boolean;
}) {
  const { t } = useTranslation();
  const pick = useChooseSource(candidates);
  const L = (k: string) => t(`contracts.sourcing.col.${k}`);
  return (
    <>
      {pick.isError && (
        <p role="alert" className="px-5 py-2 text-[13px] text-late">
          {sourcingErrorText(pick.error, t)}
        </p>
      )}
      <table className="w-full min-w-[980px] border-collapse">
        <thead>
          <tr>
            {showContract && <th className={th}>{L("sale")}</th>}
            <th className={th}>{L("product")}</th>
            <th className={cn(th, "text-right")}>{L("price")}</th>
            <th className={th}>{L("source")}</th>
            <th className={cn(th, "text-right")}>{L("buy")}</th>
            <th className={cn(th, "text-right")}>{L("margin")}</th>
            <th className={cn(th, "text-right")}>{L("profit")}</th>
            <th className={th}>{L("risk")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={refKey(r)} data-testid="sale-line" className="align-top hover:bg-sunk">
              {showContract && (
                <td className={`${td} text-[13px]`}>
                  <Link
                    to="/contracts/$id"
                    params={{ id: r.contract_id }}
                    className="font-mono font-medium text-act hover:underline"
                  >
                    {r.number ?? "HĐ"}
                  </Link>
                  <span className="block text-dim">{r.customer.name ?? "—"}</span>
                </td>
              )}
              <td className={`${td} text-[13px]`}>
                {r.name}
                {r.qty != null && (
                  <span className="block text-dim">
                    {t("contracts.sourcing.qty", { n: vnd(r.qty), unit: r.unit ?? "" })}
                  </span>
                )}
              </td>
              <td className={`${td} text-right text-[13px]`}>{money(r.price)}</td>
              <td className={`${td} text-[13px]`}>
                <SourceCell
                  r={r}
                  options={write ? (candidates[r.product] ?? []) : []}
                  busy={pick.isPending}
                  onPick={(value) => pick.mutate({ r, value })}
                />
              </td>
              <td className={`${td} text-right text-[13px]`}>{money(r.source?.price ?? null)}</td>
              <td className={`${td} text-right text-[13px]`}>
                {money(r.margin)}
                {r.margin_pct != null && (
                  <span className="block text-dim">{r.margin_pct.toFixed(1)}%</span>
                )}
              </td>
              <td className={`${td} text-right text-[13px]`}>{money(r.profit)}</td>
              <td className={td}>
                {r.risk ? (
                  <span
                    className={cn(
                      "rounded-full px-2.5 py-0.5 text-xs font-semibold",
                      RISK_TONE[r.risk],
                    )}
                  >
                    {t(`contracts.sourcing.risk.${r.risk}`)}
                  </span>
                ) : (
                  <span className="text-[13px] text-dim">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

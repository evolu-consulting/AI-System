// Khối "Giá bán & lãi" của tab "Nhà cung cấp & giá": giá bán gần đây từ HĐ bán đã xác nhận, giá vốn tham chiếu, lãi/đơn vị.
// Số liệu do máy chủ tính (`SupplierOverviewOut.pricing`); không có nguồn mua ⇒ gợi ý "dịch vụ tự làm?".
import type { ProductPricing } from "@ai/contracts";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { viDate, vnd } from "~/components/shared/format";
import { Panel } from "~/components/shared/layout";

export function PricingPanel({ pricing }: { pricing: ProductPricing }) {
  const { t } = useTranslation();
  const L = (k: string, o?: Record<string, unknown>) => t(`contracts.psup.pricing.${k}`, o);
  if (pricing.sales.length === 0 && !pricing.has_buy) return null;
  return (
    <Panel>
      <h3
        className="border-b border-rule-soft px-4 py-3 text-base font-semibold"
        data-testid="psup-pricing"
      >
        {L("title")}
      </h3>
      <div className="grid gap-3 px-4 py-3 text-sm sm:grid-cols-4">
        <Stat label={L("sell")} value={pricing.sell_price} />
        <Stat
          label={L(pricing.buy_basis === "stock" ? "costStock" : "cost")}
          value={pricing.buy_cost}
        />
        <Stat label={L("margin")} value={pricing.margin} />
        <div>
          <div className="text-xs text-dim">{L("marginPct")}</div>
          <b className="font-mono tnum" data-testid="psup-margin-pct">
            {pricing.margin_pct === null ? "—" : `${pricing.margin_pct.toFixed(1)}%`}
          </b>
        </div>
      </div>
      {!pricing.has_buy && (
        <p className="px-4 pb-3 text-sm text-dim">{t("contracts.sourcing.noSource")}</p>
      )}
      {pricing.sales.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px]">
            <tbody>
              {pricing.sales.map((s) => (
                <tr key={s.contract_id} data-testid="psup-sale">
                  <td className="border-t border-rule-soft px-4 py-2.5 text-sm font-semibold">
                    {s.customer ?? "—"}
                  </td>
                  <td className="border-t border-rule-soft px-4 py-2.5 text-right font-mono text-sm tnum">
                    {vnd(s.price)}
                  </td>
                  <td className="border-t border-rule-soft px-4 py-2.5 text-sm">
                    <Link
                      to="/contracts/$id"
                      params={{ id: s.contract_id }}
                      className="text-act hover:underline"
                    >
                      {s.number ?? t("contracts.gape.contractShort")}
                    </Link>
                    {s.current && <span className="tag ml-2 text-[11px]">{L("current")}</span>}
                  </td>
                  <td className="border-t border-rule-soft px-4 py-2.5 text-sm text-dim tnum">
                    {s.on ? viDate(s.on) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function Stat({ label, value }: { label: string; value: number | null }) {
  return (
    <div>
      <div className="text-xs text-dim">{label}</div>
      <b className="font-mono tnum">{value === null ? "—" : vnd(value)}</b>
    </div>
  );
}

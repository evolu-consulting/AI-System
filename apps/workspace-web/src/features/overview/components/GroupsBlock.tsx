// V2-N · "Theo nhóm sản phẩm" (mockup `revChart`): mỗi nhóm một hàng — tổng kỳ, % so kỳ trước, 12 cột tháng (N tháng cuối của kỳ đậm).
import type { OverviewOut } from "@ai/contracts";
import { useTranslation } from "react-i18next";
import { Panel } from "~/components/shared/layout";
import { barHeights, GROUP_ORDER, inPeriod, moneyShort, monthLabel } from "../lib/overview";
import { BlockHead } from "./BlockHead";
import { Delta } from "./KpiBlock";

const COLOR = {
  service: "var(--chart-1, #2563eb)",
  goods: "var(--chart-2, #0d9488)",
  referral: "var(--chart-3, #d97706)",
} as const;

export function GroupsBlock({ data }: { data: OverviewOut }) {
  const { t } = useTranslation();
  const rows = [...data.groups].sort((a, b) => GROUP_ORDER[a.group] - GROUP_ORDER[b.group]);
  const per = t(`contracts.overview.period.${data.period}`).toLowerCase();
  return (
    <Panel>
      <BlockHead
        title={t("contracts.overview.groups.title")}
        meta={t("contracts.overview.groups.lead", { period: per })}
      />
      <div className="flex flex-col gap-3 p-4 px-5" data-testid="groups">
        {rows.map((r) => {
          const hs = barHeights(r.months.map((m) => m.value));
          const label = t(`contracts.overview.groups.${r.group}`);
          return (
            <div
              key={r.group}
              data-group={r.group}
              className="grid grid-cols-[minmax(0,9rem)_minmax(0,7rem)_minmax(0,1fr)] items-center gap-3 max-sm:grid-cols-1"
            >
              <span className="flex items-center gap-2 text-body">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ background: COLOR[r.group] }}
                />
                <span>
                  <b className="block">{label}</b>
                  <span className="block text-[12px] text-dim">
                    {t(`contracts.overview.groups.basis.${r.basis}`, { period: per })}
                  </span>
                </span>
              </span>
              <span className="flex flex-col">
                <b className="tnum">{moneyShort(r.total)}</b>
                <Delta pct={r.change_pct} />
              </span>
              <div
                role="img"
                aria-label={t("contracts.overview.groups.byMonth", { group: label })}
                className="flex h-12 items-end gap-1"
              >
                {r.months.map((m, i) => (
                  <span
                    key={m.month}
                    title={`${monthLabel(m.month)}: ${moneyShort(m.value)}`}
                    className={`block flex-1 rounded-sm ${inPeriod(i, r.months.length, data.period) ? "" : "opacity-35"}`}
                    style={{ height: `${hs[i]}%`, background: COLOR[r.group] }}
                  />
                ))}
              </div>
            </div>
          );
        })}
        <div className="grid grid-cols-[minmax(0,9rem)_minmax(0,7rem)_minmax(0,1fr)] gap-3 text-[11px] text-dim max-sm:hidden">
          <span />
          <span />
          <div className="flex gap-1">
            {data.months.map((m) => (
              <span key={m} className="flex-1 text-center">
                {monthLabel(m)}
              </span>
            ))}
          </div>
        </div>
      </div>
    </Panel>
  );
}

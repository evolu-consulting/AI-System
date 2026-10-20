// nav-v2 · khối "Hợp đồng" của Tổng quan: số hợp đồng theo nhóm trạng thái (facets) + HĐ sắp hết hiệu lực nhất. Dùng API danh sách HĐ sẵn có
// (`GET /contracts/facets`, `GET /contracts`), người dùng chỉ thấy HĐ mình được xem (RLS).
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { viDate } from "~/components/shared/format";
import { Panel } from "~/components/shared/layout";
import { ErrorLine, Loading } from "~/components/shared/states";
import { FACETS_KEY, fetchFacets, fetchList, listKey } from "~/features/contracts-list/api";
import { cn } from "~/lib/utils";
import { CONTRACT_GROUPS, counterparty, daysLeft, EXPIRING_QS, groupCounts } from "../lib/overview";
import { BlockHead } from "./BlockHead";

const TILE: Record<(typeof CONTRACT_GROUPS)[number], string> = {
  pending: "hover:border-act-line",
  active: "border-act bg-act-soft text-act hover:border-act",
  done: "hover:border-act-line",
};

export function ContractsBlock({ today }: { today?: string }) {
  const { t } = useTranslation();
  const facets = useQuery({ queryKey: FACETS_KEY, queryFn: ({ signal }) => fetchFacets(signal) });
  const soon = useQuery({
    queryKey: listKey(EXPIRING_QS),
    queryFn: ({ signal }) => fetchList(EXPIRING_QS, signal),
  });
  const { total, counts } = groupCounts(facets.data);
  const rows = soon.data?.items ?? [];
  return (
    <Panel>
      <BlockHead
        title={t("contracts.overview.contracts.title")}
        meta={facets.data && t("contracts.overview.contracts.count", { n: total })}
        aside={
          <Link to="/contracts" className="font-medium text-act hover:underline">
            {t("contracts.overview.contracts.all")}
          </Link>
        }
      />
      <div className="p-4 pt-3.5">
        {facets.isLoading ? (
          <Loading />
        ) : facets.error ? (
          <ErrorLine error={facets.error} />
        ) : (
          <ul
            className="grid grid-cols-3 gap-2"
            aria-label={t("contracts.overview.contracts.title")}
          >
            {CONTRACT_GROUPS.map((g) => (
              <li key={g} className="contents">
                <Link
                  to="/contracts"
                  data-group={g}
                  className={cn(
                    "flex flex-col items-start gap-0.5 rounded-xl border border-rule bg-panel px-3 py-2.5 transition-colors",
                    TILE[g],
                  )}
                >
                  <b className="tnum text-[22px] leading-tight font-semibold">{counts[g]}</b>
                  <span className={cn("text-[12.5px]", g === "active" ? "text-act" : "text-ink-2")}>
                    {t(`contracts.overview.contracts.${g}`)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <h3 className="mt-4 mb-1 text-label font-semibold text-dim">
          {t("contracts.overview.contracts.expiring")}
        </h3>
        {soon.isLoading ? (
          <Loading />
        ) : soon.error ? (
          <ErrorLine error={soon.error} />
        ) : rows.length === 0 ? (
          <p className="py-2 text-label text-dim">
            {t("contracts.overview.contracts.expiringNone")}
          </p>
        ) : (
          <ul data-testid="expiring-list">
            {rows.map((r) => {
              const n = daysLeft(r.end_date, today);
              return (
                <li
                  key={r.id}
                  className="flex items-center justify-between gap-3 border-t border-rule-soft py-2.5 first:border-t-0"
                >
                  <span className="min-w-0">
                    <Link
                      to="/contracts/$id"
                      params={{ id: r.id }}
                      className="block truncate text-body font-semibold hover:underline"
                    >
                      {r.title}
                    </Link>
                    <span className="block truncate text-[12.5px] text-dim">
                      {[counterparty(r), r.end_date ? viDate(r.end_date) : ""]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                  {n != null && (
                    <span className="shrink-0 text-label font-semibold text-soon">
                      {n === 0
                        ? t("contracts.overview.contracts.leftToday")
                        : t("contracts.overview.contracts.left", { n })}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Panel>
  );
}

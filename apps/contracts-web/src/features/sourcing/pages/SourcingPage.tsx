// W1 · /sourcing "Mua hàng" (port cm-web `sourcing/page.tsx`): 4 ô số, bảng hàng đang bán (tìm, lọc rủi ro, phân trang — tính ở máy chủ) và
// bảng "Phụ thuộc vào nhà cung cấp". Đổi nguồn cần quyền ghi.
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useDeferredValue, useState } from "react";
import { useTranslation } from "react-i18next";
import { vnd } from "~/components/shared/format";
import { PageHead, Panel, Stat } from "~/components/shared/layout";
import { Empty, ErrorLine, Loading } from "~/components/shared/states";
import { useMe } from "~/features/pack-state/hooks/use-me";
import { Pager, TableTools } from "~/features/table";
import { fetchSourcing, type SourcingParams, sourcingKeys } from "../api";
import { SaleLines } from "../components/SaleLines";
import { SuppliersTable } from "../components/SuppliersTable";

export function SourcingPage() {
  const { t } = useTranslation();
  const me = useMe();
  const [risky, setRisky] = useState(false);
  const [q, setQ] = useState("");
  const [paging, setPaging] = useState({ page: 1, size: 20 });
  const dq = useDeferredValue(q);
  const params: SourcingParams = { q: dq, risk: risky, page: paging.page, page_size: paging.size };
  const query = useQuery({
    queryKey: sourcingKeys.list(params),
    queryFn: ({ signal }) => fetchSourcing(params, signal),
    placeholderData: keepPreviousData,
  });
  const d = query.data;
  const L = (k: string, o?: Record<string, unknown>) => t(`contracts.sourcing.${k}`, o);
  const reset = (next: Partial<typeof paging> = {}) => setPaging({ ...paging, page: 1, ...next });
  const total = d?.total ?? 0;
  const pager = {
    page: paging.page,
    pages: Math.max(1, Math.ceil(total / paging.size)),
    setPage: (page: number) => setPaging({ ...paging, page }),
    total,
    pageSize: paging.size,
    setPageSize: (size: number) => reset({ size }),
  };
  const body = () => {
    if (query.isLoading) return <Loading />;
    if (query.error) return <ErrorLine error={query.error} />;
    if (!d?.stats.lines) return <Empty title={L("emptyTitle")}>{L("emptyBody")}</Empty>;
    if (!d.total) return <Empty title={risky ? L("noRisk") : t("contracts.cks.noMatchTitle")} />;
    return <SaleLines rows={d.lines} candidates={d.candidates} write={me.write} showContract />;
  };
  return (
    <div className="text-base leading-[1.55]">
      <PageHead title={L("title")} lead={L("lead")} />
      <div className="mb-5 grid grid-cols-4 gap-3 max-md:grid-cols-2">
        <Stat loading={query.isLoading} value={d?.stats.lines ?? 0} label={L("stat.lines")} />
        <Stat
          loading={query.isLoading}
          value={<span className="font-mono text-[20px]">{vnd(d?.stats.profit ?? 0)} đ</span>}
          label={L("stat.profit")}
        />
        <Stat loading={query.isLoading} value={d?.stats.sourced ?? 0} label={L("stat.sourced")} />
        <Stat
          loading={query.isLoading}
          value={d?.stats.at_risk ?? 0}
          label={L("stat.risk")}
          tone={d?.stats.at_risk ? "soon" : undefined}
        />
      </div>
      <TableTools
        q={q}
        setQ={(v) => {
          setQ(v);
          reset();
        }}
        total={total}
        placeholder={L("search")}
      >
        <label className="flex items-center gap-2 text-[13px]">
          <input
            type="checkbox"
            checked={risky}
            onChange={(e) => {
              setRisky(e.target.checked);
              reset();
            }}
            className="h-4 w-4"
          />
          {L("onlyRisk")}
        </label>
      </TableTools>
      <Panel className="mb-5">
        <h2 className="border-b border-rule px-5 py-3.5 text-[15px] font-semibold">
          {L("selling")}
        </h2>
        <div className="overflow-x-auto">{body()}</div>
        <Pager t={pager} />
      </Panel>
      {d?.truncated && (
        <p role="status" className="mb-3 text-[13px] text-dim">
          {L("truncated")}
        </p>
      )}
      {!!d?.suppliers.length && <SuppliersTable suppliers={d.suppliers} />}
    </div>
  );
}

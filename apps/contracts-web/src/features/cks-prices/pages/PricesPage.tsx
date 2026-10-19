// HD-FR-96 · HD-FR-97 · S08 `/prices` — `PricesPage.tsx:27-45` (ô "Mặt hàng", mặc định Chữ ký số; hàng hoá ở HD8, D9-13) + tab
// `CksPricesTab.tsx:57-197`: 4 số 12 tháng, chip lọc gói, tìm + lọc thiết bị + cột, dải "Dò giá", bảng gói, chú thích nguồn giá.
import type { CksPackageFilter, CksPackageRow } from "@ai/contracts";
import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { confirmDialog } from "~/components/shared/dialog-bus";
import { viDate } from "~/components/shared/format";
import { PageHead, Panel, Stat } from "~/components/shared/layout";
import { Chips, Empty, ErrorLine, Loading } from "~/components/shared/states";
import { cksErrorText } from "~/features/cks/lib/cks";
import { useMe } from "~/features/pack-state/hooks/use-me";
import {
  type Column,
  ColumnFilters,
  ColumnPicker,
  Pager,
  TableTools,
  useColumns,
  useTable,
} from "~/features/table";
import { fetchCksPrices, fetchScans, pricesKey, scansKey, startScan } from "../api";
import { PackageTable } from "../components/PackageTable";
import { ScanStrip } from "../components/ScanStrip";
import { tr } from "../lib/prices";

const KEYS = ["pkg", "buy", "sell", "margin", "pct", "market", "sold"] as const;

function Stats({
  s,
}: {
  s:
    | { sold_12m: number; revenue: number; gross_profit: number; margin_pct: number | null }
    | undefined;
}) {
  const { t } = useTranslation();
  const L = (k: string) => t(`contracts.cks.prices.${k}`);
  return (
    <div className="mb-5 grid grid-cols-4 gap-3 max-md:grid-cols-2">
      <Stat value={s?.sold_12m ?? "–"} label={L("sold12m")} />
      <Stat
        value={s ? <span className="font-mono">{tr(s.revenue)}</span> : "–"}
        label={L("revenue")}
      />
      <div className="rounded-xl border border-act-line bg-act-soft px-4 py-3.5 text-act">
        <p className="tnum font-mono text-[26px] leading-tight font-medium">
          {s ? tr(s.gross_profit) : "–"}
        </p>
        <p className="text-[13px]">{L("profit")}</p>
      </div>
      <Stat
        value={s?.margin_pct != null ? `${s.margin_pct.toLocaleString("vi-VN")}%` : "–"}
        label={L("marginAvg")}
      />
    </div>
  );
}

function useScan(setErr: (e: string | null) => void, refetch: () => void) {
  const { t } = useTranslation();
  return async (r: CksPackageRow) => {
    const ok = await confirmDialog({
      title: t("contracts.cks.prices.scanConfirm", { ca: r.ca }),
      body: t("contracts.cks.prices.scanBody"),
      confirmLabel: t("contracts.cks.prices.scanGo"),
    });
    if (!ok) return;
    setErr(null);
    try {
      await startScan(r.ca, r.years, r.device);
      refetch();
    } catch (e) {
      setErr(cksErrorText(e, t));
    }
  };
}

function Foot({ seen }: { seen: string | null }) {
  const { t } = useTranslation();
  const L = (k: string, o?: Record<string, unknown>) => t(`contracts.cks.prices.${k}`, o);
  return (
    <p className="border-t border-rule-soft px-5 py-3 text-[12.5px] text-dim">
      {L("foot1", { seen: seen ? L("footSeen", { date: viDate(seen) }) : "" })} {L("foot2")}
    </p>
  );
}

/** S09 (bảng rẻ nhất thị trường) thuộc HD8 — D9-13: nút giữ nguyên, panel báo lát sau. */
function MarketPanel({ close }: { close: () => void }) {
  const { t } = useTranslation();
  const L = (k: string) => t(`contracts.cks.prices.${k}`);
  return (
    <Panel className="flex flex-col">
      <Empty title={L("checkMarket")}>{L("marketPanel")}</Empty>
      <button type="button" className="btn btn-quiet m-4 self-end" onClick={close}>
        {L("close")}
      </button>
    </Panel>
  );
}

/** `productPicker` (HD8): ô "Mặt hàng" đầy đủ (Chữ ký số + hàng hoá) do trang /prices truyền vào; vắng ⇒ ô chỉ có Chữ ký số (D9-13). */
export function PricesPage({ productPicker }: { productPicker?: ReactNode } = {}) {
  const { t } = useTranslation();
  const L = (k: string, o?: Record<string, unknown>) => t(`contracts.cks.prices.${k}`, o);
  const [f, setF] = useState<CksPackageFilter>("all");
  const q = useQuery({
    queryKey: pricesKey(f),
    queryFn: ({ signal }) => fetchCksPrices(f, signal),
  });
  const scans = useQuery({ queryKey: scansKey, queryFn: ({ signal }) => fetchScans(signal) });
  const me = useMe();
  const [err, setErr] = useState<string | null>(null);
  const [showMarket, setShowMarket] = useState(false);
  const tb = useTable(q.data?.rows, {
    text: (r) =>
      `${r.label} ${r.device_label} ${(r.market?.sources ?? []).map((x) => x.seller).join(" ")}`,
    filters: [{ key: "device", label: L("device"), value: (r) => r.device_label }],
  });
  const cols: Column[] = KEYS.map((k) => ({
    key: k,
    label: L(`col.${k}`),
    locked: k === "pkg" || k === "market",
  }));
  const picker = useColumns("cks-prices", cols);
  const shown = cols.filter((c) => picker.shows(c.key));
  const scan = useScan(setErr, () => void scans.refetch());
  const body = () => {
    if (q.isLoading) return <Loading />;
    if (q.error) return <ErrorLine error={q.error} />;
    if (!q.data?.rows.length) return <Empty title={L("emptyTitle")}>{L("emptyBody")}</Empty>;
    if (!tb.total) return <Empty title={L("noMatchTitle")}>{t("contracts.cks.noMatchBody")}</Empty>;
    const jobs = scans.data ?? [];
    return (
      <PackageTable
        rows={tb.shown}
        shown={shown}
        write={me.write}
        jobs={jobs}
        scan={(r) => void scan(r)}
      />
    );
  };
  return (
    <div className="text-base leading-[1.55]">
      <PageHead
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span className="md:hidden">{L("title")}</span>
            {productPicker ?? (
              <select
                aria-label={L("product")}
                value="cks"
                onChange={() => {}}
                className="field h-9 w-auto py-0 text-[15px] font-medium"
              >
                <option value="cks">{t("contracts.cks.product")}</option>
              </select>
            )}
          </span>
        }
      />
      <Stats s={q.data?.stats} />
      <Chips
        label={L("filterLabel")}
        value={f}
        onChange={setF}
        items={[
          { id: "all", label: L("all") },
          { id: "1y", label: L("y1") },
          { id: "multi", label: L("multi") },
          { id: "token", label: t("contracts.cks.token") },
          { id: "remote", label: t("contracts.cks.remote") },
        ]}
      />
      <TableTools q={tb.q} setQ={tb.setQ} total={tb.total} placeholder={L("search")}>
        <ColumnFilters filter={tb.filter} />
        <span className="max-sm:hidden">
          <ColumnPicker cols={picker} />
        </span>
      </TableTools>
      <ScanStrip jobs={scans.data ?? []} />
      {err && (
        <p role="alert" className="mb-3 text-sm text-late">
          {err}
        </p>
      )}
      <div className={`grid items-stretch gap-4 ${showMarket ? "xl:grid-cols-2" : "grid-cols-1"}`}>
        <Panel className={showMarket ? "xl:flex xl:max-h-[72vh] xl:flex-col" : "overflow-x-auto"}>
          <div className="flex flex-wrap items-center gap-3 border-b border-rule px-5 py-3.5">
            <h2 className="text-[15px] font-semibold">{L("mine")}</h2>
            <p className="text-[12.5px] text-dim max-xl:hidden">{L("mineLead")}</p>
            {!showMarket && (
              <button
                type="button"
                className="btn btn-outline btn-sm ml-auto"
                onClick={() => setShowMarket(true)}
              >
                {L("checkMarket")}
              </button>
            )}
          </div>
          <div className={showMarket ? "overflow-auto xl:min-h-0 xl:flex-1" : "overflow-x-auto"}>
            {body()}
          </div>
          <Pager t={tb} />
          <Foot seen={q.data?.market_seen ?? null} />
        </Panel>
        {showMarket && <MarketPanel close={() => setShowMarket(false)} />}
      </div>
    </div>
  );
}

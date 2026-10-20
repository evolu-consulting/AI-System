// HD-FR-93 · HD-FR-97 · S10 `/cks` — port `CksPage.tsx:26-133` (4 số, chip lọc, lô, nhà cung cấp, bảng khách mở rộng được, 2 hộp
// thoại). Khác bên dưới (HD9-AC09): bảng phân trang + tìm ở SERVER (`?q&page&page_size`), giao diện giữ nguyên.
import type { CksCustomerBrief, CksCustomerPage } from "@ai/contracts";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useSearch } from "@tanstack/react-router";
import { Fragment, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { PageHead, Panel, Stat, useEmbedded } from "~/components/shared/layout";
import { Empty, ErrorLine, Loading } from "~/components/shared/states";
import { useMe } from "~/features/pack-state/hooks/use-me";
import {
  type Column,
  ColumnPicker,
  Pager,
  TableTools,
  useColumns,
  useTable,
} from "~/features/table";
import {
  type CustomerQuery,
  cksKeys,
  createLot,
  createSale,
  fetchCustomers,
  fetchLots,
  fetchOverview,
} from "../api";
import { CksFilters, type Filter } from "../components/CksFilters";
import { CustomerRow, Expanded } from "../components/CustomerRows";
import { NewLotDialog } from "../components/NewLotDialog";
import { NewSaleDialog } from "../components/NewSaleDialog";

const th =
  "px-4 py-3 text-left text-xs font-semibold text-dim whitespace-nowrap sticky top-0 z-10 bg-sunk";
const KEYS = ["name", "ca", "earliest", "price", "signed"] as const;

function useColumnsCks() {
  const { t } = useTranslation();
  const cols: Column[] = KEYS.map((k) => ({
    key: k,
    label: t(`contracts.cks.col.${k}`),
    locked: k === "name",
  }));
  return { all: cols, picker: useColumns("cks-customers", cols) };
}

function CustomersTable({ rows, shown }: { rows: CksCustomerBrief[]; shown: string[] }) {
  const { all } = useColumnsCks();
  const [open, setOpen] = useState<string | null>(null);
  return (
    <table className="w-full" style={{ minWidth: Math.max(420, shown.length * 144) }}>
      <thead className="bg-sunk">
        <tr>
          {all
            .filter((c) => shown.includes(c.key))
            .map((c) => (
              <th
                key={c.key}
                className={`${th} ${c.key === "price" || c.key === "signed" ? "text-right" : ""}`}
              >
                {c.label}
              </th>
            ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((c) => (
          <Fragment key={c.company_id}>
            <CustomerRow
              c={c}
              shown={shown}
              open={open === c.company_id}
              toggle={() => setOpen(open === c.company_id ? null : c.company_id)}
            />
            {open === c.company_id && <Expanded c={c} shown={shown} />}
          </Fragment>
        ))}
      </tbody>
    </table>
  );
}

function OverviewStats() {
  const { t } = useTranslation();
  const ov = useQuery({
    queryKey: cksKeys.overview,
    queryFn: ({ signal }) => fetchOverview(signal),
  });
  const n = (v: number | undefined) => v ?? 0;
  const S = (k: string, o?: Record<string, unknown>) => t(`contracts.cks.stat.${k}`, o);
  return (
    <div className="mb-5 grid grid-cols-4 gap-3 max-md:grid-cols-2">
      <Stat
        loading={ov.isLoading}
        value={n(ov.data?.certificates)}
        label={ov.isLoading ? S("certsLoading") : S("certs", { n: n(ov.data?.customers) })}
      />
      <Stat
        loading={ov.isLoading}
        value={n(ov.data?.expiring_30)}
        label={S("expiring")}
        tone="soon"
      />
      <Stat loading={ov.isLoading} value={n(ov.data?.expired)} label={S("expired")} tone="late" />
      <Stat loading={ov.isLoading} value={n(ov.data?.in_stock)} label={S("inStock")} />
    </div>
  );
}

type RowsQuery = { isLoading: boolean; error: unknown; data?: CksCustomerPage | undefined };
/** mgmt: lọc chip/lô/CA ra rỗng cũng là "Chưa có chữ ký số"; chỉ ô tìm ra rỗng mới là "Không có khách khớp". */
function CustomersBody({ rows, q, shown }: { rows: RowsQuery; q: string; shown: string[] }) {
  const { t } = useTranslation();
  if (rows.isLoading) return <Loading />;
  if (rows.error) return <ErrorLine error={rows.error} />;
  if (!rows.data?.total)
    return q.trim() ? (
      <Empty title={t("contracts.cks.noMatchTitle")}>{t("contracts.cks.noMatchBody")}</Empty>
    ) : (
      <Empty title={t("contracts.cks.emptyTitle")}>{t("contracts.cks.emptyBody")}</Empty>
    );
  return <CustomersTable rows={rows.data.items} shown={shown} />;
}

export function CksPage() {
  const { t } = useTranslation();
  const embedded = useEmbedded();
  const me = useMe();
  const search = useSearch({ strict: false }) as { filter?: Filter["filter"]; lot?: string };
  const [f, setF] = useState<Filter>({ filter: search.filter, lot: search.lot });
  const { all, picker } = useColumnsCks();
  const shown = all.filter((c) => picker.shows(c.key)).map((c) => c.key);
  const [q, setQ] = useState("");
  const [paging, setPaging] = useState({ page: 1, size: 20 });
  const query: CustomerQuery = {
    ...f,
    q: q.trim() || undefined,
    page: paging.page,
    page_size: paging.size,
  };
  const rows = useQuery({
    queryKey: cksKeys.customers(query),
    queryFn: ({ signal }) => fetchCustomers(query, signal),
    placeholderData: keepPreviousData,
  });
  const lots = useQuery({ queryKey: cksKeys.lots, queryFn: ({ signal }) => fetchLots(signal) });
  const tb = useTable(rows.data?.items, {
    text: () => "",
    serverTotal: rows.data?.total ?? 0,
    pageSize: paging.size,
  });
  const pager = {
    ...tb,
    page: paging.page,
    pageSize: paging.size,
    setPage: (page: number) => setPaging({ ...paging, page }),
    setPageSize: (size: number) => setPaging({ page: 1, size }),
  };
  const lotDlg = useRef<HTMLDialogElement>(null);
  const saleDlg = useRef<HTMLDialogElement>(null);
  const setFilter = (next: Filter) => {
    setF(next);
    setPaging({ ...paging, page: 1 });
  };
  return (
    <div className="text-base leading-[1.55] md:flex md:min-h-0 md:flex-1 md:flex-col">
      <PageHead
        title={
          <span className="flex flex-wrap items-center gap-3">
            {!embedded && <span className="md:hidden">{t("contracts.cks.products")}</span>}
            <span className="rounded-lg bg-act-soft px-2.5 py-1 text-[14px] font-medium text-act">
              {t("contracts.cks.product")}
            </span>
          </span>
        }
        actions={
          me.write && (
            <>
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => lotDlg.current?.showModal()}
              >
                {t("contracts.cks.newLot")}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => saleDlg.current?.showModal()}
              >
                {t("contracts.cks.newSale")}
              </button>
            </>
          )
        }
      />
      <OverviewStats />
      <CksFilters f={f} setF={setFilter} lots={lots.data ?? []} cas={rows.data?.cas ?? []} />
      <TableTools
        q={q}
        setQ={(v) => {
          setQ(v);
          setPaging({ ...paging, page: 1 });
        }}
        total={rows.data?.total ?? 0}
        placeholder={t("contracts.cks.search")}
      >
        <span className="max-sm:hidden">
          <ColumnPicker cols={picker} />
        </span>
      </TableTools>
      <Panel className="md:flex md:min-h-0 md:flex-1 md:flex-col">
        <div className="overflow-auto md:min-h-0 md:flex-1">
          <CustomersBody rows={rows} q={q} shown={shown} />
        </div>
        <Pager t={pager} />
      </Panel>
      <NewLotDialog dlg={lotDlg} create={createLot} />
      <NewSaleDialog dlg={saleDlg} lots={lots.data ?? []} create={createSale} />
    </div>
  );
}

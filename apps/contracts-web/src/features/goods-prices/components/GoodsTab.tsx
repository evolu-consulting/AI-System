// HD8-FR-05 · HD8-FR-06 · so giá một mặt hàng — port `mgmt-app/web/src/pages/prices/PricesPage.tsx:47-124`: NCC, đơn giá, uy tín
// (điểm · mức), nguồn giá; NCC chưa từng có HĐ gắn "MỚI"; dòng giá thị trường (hàng hoá chưa có ⇒ "Chưa có (đang phát triển)").
import type { GoodsPriceRow } from "@ai/contracts";
import { useQuery } from "@tanstack/react-query";
import { Fragment, type ReactNode, useRef } from "react";
import { useTranslation } from "react-i18next";
import { viDate, vnd } from "~/components/shared/format";
import { PageHead, Panel, useEmbedded } from "~/components/shared/layout";
import { Empty, ErrorLine, Loading } from "~/components/shared/states";
import { useMe } from "~/features/pack-state/hooks/use-me";
import { fetchCompare, partnerKeys } from "~/features/partners/api";
import { BAND_TEXT } from "~/features/partners/components/ScoreBadge";
import {
  type Column,
  ColumnFilters,
  ColumnPicker,
  Pager,
  TableTools,
  useColumns,
  useTable,
} from "~/features/table";
import { AddQuote } from "./AddQuote";

const th = "px-4 py-3 text-left text-xs font-semibold text-dim sticky top-0 z-10 bg-sunk";
const td = "border-t border-rule-soft px-4 py-3.5 text-sm";
type T = (k: string, o?: Record<string, unknown>) => string;

export function sourceText(s: GoodsPriceRow["source"], L: T): string {
  if (s.type === "contract") return L("fromContract");
  if (s.type === "quote") return L("fromQuote", { date: viDate(s.date) });
  return L("fromWebsite", { date: viDate(s.date) });
}

function cellsOf({
  r,
  L,
  tb,
}: {
  r: GoodsPriceRow;
  L: T;
  tb: (k: string) => string;
}): Record<string, ReactNode> {
  return {
    supplier: (
      <td className={`${td} font-semibold`}>
        {r.supplier}
        {r.is_new && <span className="tag ml-2 text-[11px] font-semibold">{L("new")}</span>}
      </td>
    ),
    price: <td className={`${td} text-right font-mono tnum`}>{vnd(r.price)}</td>,
    score: (
      <td className={td}>
        {r.score != null && r.band ? (
          <span className={`font-semibold ${BAND_TEXT[r.band]}`}>
            {r.score} · {tb(r.band)}
          </span>
        ) : (
          <span className="text-dim">{L("noScore")}</span>
        )}
      </td>
    ),
    source: <td className={`${td} text-dim`}>{sourceText(r.source, L)}</td>,
  };
}

export function GoodsTab({ picker, product }: { picker: ReactNode; product: string }) {
  const { t } = useTranslation();
  const embedded = useEmbedded();
  const L: T = (k, o) => t(`contracts.goods.${k}`, o);
  const tb = (b: string) => t(`contracts.partners.band.${b}`);
  const cmp = useQuery({
    queryKey: partnerKeys.compare(product),
    queryFn: ({ signal }) => fetchCompare(product, signal),
  });
  const { write } = useMe();
  const dlg = useRef<HTMLDialogElement>(null);
  const COLUMNS: Column[] = ["supplier", "price", "score", "source"].map((k) => ({
    key: k,
    label: L(`col.${k}`),
    locked: k === "supplier",
  }));
  const cols = useColumns("quotes", COLUMNS);
  const shown = COLUMNS.filter((c) => cols.shows(c.key));
  const table = useTable(cmp.data?.rows, {
    text: (r) => `${r.supplier} ${sourceText(r.source, L)}`,
    filters: [{ key: "source", label: L("source"), value: (r) => sourceText(r.source, L) }],
  });
  const m = cmp.data?.market;
  const ok = m?.status === "ok";
  const market: Record<string, ReactNode> = {
    supplier: <td className={`${td} text-dim`}>{L("market")}</td>,
    price: (
      <td className={`${td} text-right font-mono tnum text-dim`}>
        {ok ? `${vnd(m?.min)} – ${vnd(m?.max)}` : ""}
      </td>
    ),
    score: <td className={td} />,
    source: (
      <td className={`${td} text-dim`}>
        {ok ? L("marketSeen", { date: viDate(m?.seen) }) : L("marketTbd")}
      </td>
    ),
  };
  const body = () => {
    if (cmp.isLoading) return <Loading />;
    if (cmp.error) return <ErrorLine error={cmp.error} />;
    if (!cmp.data?.rows.length) return <Empty title={L("emptyTitle")}>{L("emptyBody")}</Empty>;
    return (
      <table className="w-full" style={{ minWidth: Math.max(300, shown.length * 150) }}>
        <thead className="bg-sunk">
          <tr>
            {shown.map((c) => (
              <th key={c.key} className={`${th} ${c.key === "price" ? "text-right" : ""}`}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.shown.map((r) => {
            const cell = cellsOf({ r, L, tb });
            return (
              <tr key={`${r.supplier}:${r.source.type}`} className={r.is_new ? "bg-new-bg" : ""}>
                {shown.map((c) => (
                  <Fragment key={c.key}>{cell[c.key]}</Fragment>
                ))}
              </tr>
            );
          })}
          <tr>
            {shown.map((c) => (
              <Fragment key={c.key}>{market[c.key]}</Fragment>
            ))}
          </tr>
        </tbody>
      </table>
    );
  };
  return (
    <div className="text-base leading-[1.55]">
      <PageHead
        title={
          <span className="flex flex-wrap items-center gap-3">
            {!embedded && <span className="md:hidden">{L("compare")}</span>}
            {picker}
          </span>
        }
        actions={
          write && (
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => dlg.current?.showModal()}
            >
              {L("addQuote")}
            </button>
          )
        }
      />
      <TableTools q={table.q} setQ={table.setQ} total={table.total} placeholder={L("search")}>
        <ColumnFilters filter={table.filter} />
        <span className="max-sm:hidden">
          <ColumnPicker cols={cols} />
        </span>
      </TableTools>
      <Panel className="md:flex md:min-h-0 md:flex-1 md:flex-col">
        <div className="overflow-auto md:min-h-0 md:flex-1">{body()}</div>
        <Pager t={table} />
      </Panel>
      <AddQuote dlg={dlg} product={product} />
    </div>
  );
}

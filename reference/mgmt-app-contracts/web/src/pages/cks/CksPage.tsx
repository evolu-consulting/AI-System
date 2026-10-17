import { Fragment, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useCksCustomers, useLots, useOverview, type CksCustomer, type CksFilter } from "@/api/cks";
import { canWrite, useMe } from "@/api/session";
import { ColumnPicker, Pager, TableTools, useColumns, useTable, type Column } from "@/components/table";
import { Empty, ErrorLine, Loading, PageHead, Panel, Stat, vnd, viDate } from "@/components/ui";
import { NewLotDialog, NewSaleDialog } from "./dialogs";

const th = "px-4 py-3 text-left text-xs font-semibold text-dim whitespace-nowrap sticky top-0 z-10 bg-sunk";

const COLUMNS: Column[] = [
  { key: "name", label: "Khách hàng · hợp đồng bán", locked: true }, { key: "ca", label: "Nhà cung cấp" },
  { key: "earliest", label: "Hết hạn sớm nhất" }, { key: "price", label: "Giá bán" }, { key: "signed", label: "Đã ký" },
];

export function Expiry({ iso, days }: { iso: string; days: number }) {
  if (days < 0) return <span className="font-semibold text-late">{viDate(iso)} <span className="text-xs">Đã hết hạn</span></span>;
  if (days <= 30) return <span className="font-semibold text-soon">{viDate(iso)} <span className="text-xs">Còn {days} ngày</span></span>;
  return <span>{viDate(iso)}</span>;
}

/** What the company sells, one view each; "Chữ ký số" is the only product so far and the default. */
const PRODUCTS = [{ id: "cks", label: "Chữ ký số" }] as const;

/** p04 · Sản phẩm › Chữ ký số: four counts, then customers grouped with their sale contracts and signatures. */
export default function CksPage() {
  const { data: me } = useMe();
  const [params, setParams] = useSearchParams();
  // Links from the assistant land here filtered: ?filter=expired, ?lot=…, or ?sell_to=<company> to open a sale.
  const [f, setF] = useState<CksFilter>(() => ({
    filter: (params.get("filter") as CksFilter["filter"]) || undefined, lot: params.get("lot") || undefined,
  }));
  // a link followed while already here (/cks?filter=expired from the assistant) changes the filter too
  const urlFilter = params.get("filter"), urlLot = params.get("lot");
  useEffect(() => {
    if (urlFilter || urlLot) setF({ filter: (urlFilter as CksFilter["filter"]) || undefined, lot: urlLot || undefined });
  }, [urlFilter, urlLot]);
  const [open, setOpen] = useState<string | null>(null);
  const ov = useOverview();
  const rows = useCksCustomers(f);
  const all = useCksCustomers({});
  const lots = useLots();
  const t = useTable(rows.data, {
    text: (c) => [c.name, c.ca, ...c.certs.flatMap((x) => [x.label, x.holder_name, x.serial, x.ca])].filter(Boolean).join(" "),
  });
  const cols = useColumns("cks-customers", COLUMNS);
  const shown = COLUMNS.filter((c) => cols.shows(c.key)); // sub-rows read the keys, the group row its count
  const lotDlg = useRef<HTMLDialogElement>(null);
  const saleDlg = useRef<HTMLDialogElement>(null);
  const cas = [...new Set((all.data ?? []).map((r) => r.ca))].sort();
  const sellTo = params.get("sell_to");
  const sellName = all.data?.find((r) => r.company_id === sellTo)?.name;

  useEffect(() => {
    if (sellTo && sellName) {
      saleDlg.current?.showModal();
      setParams((p) => { p.delete("sell_to"); return p; }, { replace: true });
    }
  }, [sellTo, sellName, setParams]);
  const [prefill, setPrefill] = useState<string | undefined>();
  useEffect(() => { if (sellName) setPrefill(sellName); }, [sellName]);

  return (
    <>
      <PageHead title={
        <span className="flex flex-wrap items-center gap-3"><span className="md:hidden">Sản phẩm</span>
          {/* one product for now; when a second is added, this becomes a selector again */}
          <span className="rounded-lg bg-act-soft px-2.5 py-1 text-[14px] font-medium text-act">{PRODUCTS[0].label}</span>
        </span>
      } actions={canWrite(me) && (
        <>
          <button type="button" className="btn btn-outline" onClick={() => lotDlg.current?.showModal()}>+ Nhập lô mua</button>
          <button type="button" className="btn btn-primary" onClick={() => { setPrefill(undefined); saleDlg.current?.showModal(); }}>+ Hợp đồng bán chữ ký</button>
        </>
      )} />

      <div className="mb-5 grid grid-cols-4 gap-3 max-md:grid-cols-2">
        <Stat loading={ov.isLoading} value={ov.data?.certificates ?? 0}
          label={ov.isLoading ? "Chữ ký của khách" : `Chữ ký của ${ov.data?.customers ?? 0} khách`} />
        <Stat loading={ov.isLoading} value={ov.data?.expiring_30 ?? 0} label="Hết hạn trong 30 ngày" tone="soon" />
        <Stat loading={ov.isLoading} value={ov.data?.expired ?? 0} label="Đã hết hạn" tone="late" />
        <Stat loading={ov.isLoading} value={ov.data?.in_stock ?? 0} label="Trong kho, chưa bán" />
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <button type="button" className="chip" aria-pressed={!f.filter && !f.lot && !f.ca} onClick={() => setF({})}>Tất cả</button>
        <button type="button" className="chip text-soon" aria-pressed={f.filter === "expiring" || f.filter === "expired"}
          onClick={() => setF({ ...f, filter: f.filter ? undefined : "expiring" })}>
          {f.filter === "expired" ? "Đã hết hạn" : "Sắp hết hạn"}</button>
        <select aria-label="Theo lô mua" className="chip pr-2" value={f.lot ?? ""} onChange={(e) => setF({ ...f, lot: e.target.value || undefined })}>
          <option value="">Theo lô mua</option>
          {(lots.data ?? []).map((l) => <option key={l.id} value={l.id}>Lô {l.label} · {l.ca}</option>)}
        </select>
        <select aria-label="Nhà cung cấp" className="chip pr-2" value={f.ca ?? ""} onChange={(e) => setF({ ...f, ca: e.target.value || undefined })}>
          <option value="">Nhà cung cấp</option>
          {cas.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      <TableTools q={t.q} setQ={t.setQ} total={t.total} placeholder="Tìm theo khách, người giữ, serial, nhà cung cấp…">
        <span className="max-sm:hidden"><ColumnPicker cols={cols} /></span>
      </TableTools>
      <Panel className="md:flex md:min-h-0 md:flex-1 md:flex-col">
        <div className="overflow-auto md:min-h-0 md:flex-1">
        {rows.isLoading ? <Loading /> : rows.error ? <ErrorLine error={rows.error} /> : !rows.data?.length ? (
          <Empty title="Chưa có chữ ký số">Nhập lô mua rồi tạo hợp đồng bán, hoặc hỏi trợ lý để nhập danh sách.</Empty>
        ) : !t.total ? (
          <Empty title="Không có khách khớp">Thử từ khoá khác.</Empty>
        ) : (
          <table className="w-full" style={{ minWidth: Math.max(420, shown.length * 144) }}>
            <thead className="bg-sunk"><tr>
              {shown.map((c) => (
                <th key={c.key} className={`${th} ${c.key === "price" || c.key === "signed" ? "text-right" : ""}`}>{c.label}</th>
              ))}
            </tr></thead>
            <tbody>
              {t.shown.map((c) => (
                <Fragment key={c.company_id}>
                  <CustomerRow c={c} shown={shown.map((x) => x.key)} open={open === c.company_id} toggle={() => setOpen(open === c.company_id ? null : c.company_id)} />
                  {open === c.company_id && <Expanded c={c} shown={shown.map((x) => x.key)} />}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
        </div>
        <Pager t={t} />
      </Panel>
      <NewLotDialog ref={lotDlg} />
      <NewSaleDialog ref={saleDlg} lots={lots.data ?? []} company={prefill} />
    </>
  );
}

function CustomerRow({ c, shown, open, toggle }: { c: CksCustomer; shown: string[]; open: boolean; toggle: () => void }) {
  const has = (k: string) => shown.includes(k);
  const bg = c.days_left < 0 ? "bg-late-bg/50" : c.elsewhere ? "bg-act-soft/50" : "";
  return (
    <tr className={`border-t border-rule-soft ${bg}`}>
      <td className="px-4 py-3.5">
        <span className="flex items-center gap-3">
          <button type="button" onClick={toggle} aria-expanded={open} aria-label={`Mở ${c.name}`}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-field bg-panel text-[10px]">{open ? "▼" : "▶"}</button>
          <span>
            <Link to={`/cks/${encodeURIComponent(c.company_id)}`} className="font-semibold hover:underline">{c.name}</Link>
            <span className="text-[13px] text-dim"> · {c.cert_count} chữ ký{c.group_count ? ` · ${c.group_count} nhóm` : ""}</span>
            {c.elsewhere && <span className="tag ml-2 text-[11px] font-semibold">KHÁCH TỰ MUA · CƠ HỘI GIA HẠN</span>}
          </span>
        </span>
      </td>
      {has("ca") && <td className="px-4 text-sm">{c.ca}</td>}
      {has("earliest") && <td className="px-4 text-sm"><Expiry iso={c.earliest} days={c.days_left} /></td>}
      {has("price") && <td className="px-4 text-right font-mono text-sm tnum">{c.has_sale ? vnd(c.sale_price) : <span className="font-sans text-dim">Chưa có HĐ</span>}</td>}
      {has("signed") && <td className="px-4 text-right font-mono text-sm tnum">{c.signed_count}</td>}
    </tr>
  );
}

function Expanded({ c, shown }: { c: CksCustomer; shown: string[] }) {
  return (
    <>
      {c.sales.map((s) => (
        <Fragment key={s.contract_id}>
          <tr className="bg-sunk"><td colSpan={shown.length} className="px-4 py-2.5 pl-16 text-[13px]">
            <Link to={`/contracts/${s.contract_id}`} className="font-semibold text-act underline underline-offset-2">Hợp đồng {s.number}</Link>
            {" · "}ký {viDate(s.signed_at)} · {s.count} chữ ký × {vnd(s.price_each)} đ{s.valid_to ? ` · cùng hạn ${viDate(s.valid_to)}` : ""}
          </td></tr>
          {c.certs.filter((x) => x.sale_contract_id === s.contract_id).map((x) => <CertRow key={x.id} x={x} shown={shown} />)}
        </Fragment>
      ))}
      {c.certs.filter((x) => !x.sale_contract_id).map((x) => <CertRow key={x.id} x={x} shown={shown} />)}
    </>
  );
}

function CertRow({ x, shown }: { x: CksCustomer["certs"][number]; shown: string[] }) {
  const has = (k: string) => shown.includes(k);
  return (
    <tr className="border-t border-rule-soft text-[13.5px]">
      <td className="px-4 py-2.5 pl-16">{x.label} <span className="text-dim">· {x.device === "token" ? "USB token" : "Ký từ xa"}</span></td>
      {has("ca") && <td className="px-4">{x.ca}</td>}
      {has("earliest") && <td className="px-4">{viDate(x.valid_to)}</td>}
      {has("price") && <td className="px-4 text-right font-mono tnum">{vnd(x.sale_price)}</td>}
      {has("signed") && <td className="px-4 text-right font-mono tnum">{x.signed_count}</td>}
    </tr>
  );
}

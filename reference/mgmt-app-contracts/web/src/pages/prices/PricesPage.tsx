import { dayPlus } from "@/api/followups";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { errText } from "@/api/client";
import { addQuote, useCompare, usePriceProducts, type PriceRow } from "@/api/prices";
import { canWrite, useMe } from "@/api/session";
import { ColumnFilters, ColumnPicker, Pager, TableTools, useColumns, useTable, type Column } from "@/components/table";
import { BAND_LABEL, BAND_TEXT, Empty, ErrorLine, Loading, PageHead, Panel, vnd, viDate } from "@/components/ui";
import CksPricesTab from "./CksPricesTab";

function sourceText(s: PriceRow["source"]) {
  if (s.type === "contract") return "Hợp đồng hiện tại";
  if (s.type === "quote") return `Báo giá ${viDate(s.date)}`;
  return `Website NCC, ${viDate(s.date)}`;
}

const th = "px-4 py-3 text-left text-xs font-semibold text-dim sticky top-0 z-10 bg-sunk";
const td = "border-t border-rule-soft px-4 py-3.5 text-sm";

const COLUMNS: Column[] = [
  { key: "supplier", label: "Nhà cung cấp", locked: true }, { key: "price", label: "Đơn giá" },
  { key: "score", label: "Uy tín" }, { key: "source", label: "Nguồn giá" },
];

/** So sánh giá: goods (supplier vs supplier) or signatures (what we buy vs what we sell, against the market). */
export default function PricesPage() {
  const [params, setParams] = useSearchParams();
  const products = usePriceProducts();
  const goods = products.data ?? [];
  // Chữ ký số is the first item and the default; the rest are the ordinary goods we buy.
  const product = params.get("product") ?? "cks";
  const picker = (
    <select aria-label="Mặt hàng" value={product}
      onChange={(e) => setParams(e.target.value === "cks" ? {} : { product: e.target.value })}
      className="field h-9 w-auto py-0 text-[15px] font-medium">
      <option value="cks">Chữ ký số</option>
      {goods.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
    </select>
  );
  if (product === "cks") {
    return (<><PageHead title={<span className="flex flex-wrap items-center gap-3"><span className="md:hidden">So sánh giá</span>{picker}</span>} /><CksPricesTab /></>);
  }
  return <GoodsTab picker={picker} product={product} />;
}

function GoodsTab({ picker, product }: { picker: React.ReactNode; product: string }) {
  const cmp = useCompare(product);
  const { data: me } = useMe();
  const dlg = useRef<HTMLDialogElement>(null);
  const cols = useColumns("quotes", COLUMNS);
  const shown = COLUMNS.filter((c) => cols.shows(c.key));
  const t = useTable(cmp.data?.rows, {
    text: (r) => `${r.supplier} ${sourceText(r.source)}`,
    filters: [{ key: "source", label: "Nguồn", value: (r) => sourceText(r.source) }],
  });

  return (
    <>
      <PageHead title={<span className="flex flex-wrap items-center gap-3"><span className="md:hidden">So sánh giá</span>{picker}</span>} actions={canWrite(me) && (
        <button type="button" className="btn btn-outline" onClick={() => dlg.current?.showModal()}>+ Thêm báo giá</button>
      )} />
      <TableTools q={t.q} setQ={t.setQ} total={t.total} placeholder="Tìm theo nhà cung cấp…">
        <ColumnFilters filter={t.filter} />
        <span className="max-sm:hidden"><ColumnPicker cols={cols} /></span>
      </TableTools>

      <Panel className="md:flex md:min-h-0 md:flex-1 md:flex-col">
        <div className="overflow-auto md:min-h-0 md:flex-1">
        {cmp.isLoading ? <Loading /> : cmp.error ? <ErrorLine error={cmp.error} /> :
          !cmp.data?.rows.length ? <Empty title="Chưa có báo giá">Thêm báo giá, hoặc lưu hợp đồng mua, để có giá so sánh.</Empty> : (
            <table className="w-full" style={{ minWidth: Math.max(300, shown.length * 150) }}>
              <thead className="bg-sunk"><tr>
                {shown.map((c) => <th key={c.key} className={`${th} ${c.key === "price" ? "text-right" : ""}`}>{c.label}</th>)}
              </tr></thead>
              <tbody>
                {t.shown.map((r) => {
                  const cell: Record<string, ReactNode> = {
                    supplier: (
                      <td className={`${td} font-semibold`}>
                        {r.supplier}
                        {r.is_new && <span className="tag ml-2 text-[11px] font-semibold">MỚI{r.ai_suggested ? " · AI gợi ý" : ""}</span>}
                      </td>
                    ),
                    price: <td className={`${td} text-right font-mono tnum`}>{vnd(r.price)}</td>,
                    score: (
                      <td className={td}>{r.score != null && r.band
                        ? <span className={`font-semibold ${BAND_TEXT[r.band]}`}>{r.score} · {BAND_LABEL[r.band]}</span>
                        : <span className="text-dim">Chưa có</span>}</td>
                    ),
                    source: <td className={`${td} text-dim`}>{sourceText(r.source)}</td>,
                  };
                  return (
                    <tr key={`${r.supplier}:${r.source.type}`} className={r.is_new ? "bg-new-bg" : ""}>
                      {shown.map((c) => <Fragment key={c.key}>{cell[c.key]}</Fragment>)}
                    </tr>
                  );
                })}
                <tr>
                  {shown.map((c) => {
                    const ok = cmp.data?.market.status === "ok";
                    const mk: Record<string, ReactNode> = {
                      supplier: <td className={`${td} text-dim`}>Giá thị trường (tham khảo)</td>,
                      price: (
                        <td className={`${td} text-right font-mono tnum text-dim`}>
                          {ok ? `${vnd(cmp.data!.market.min)} – ${vnd(cmp.data!.market.max)}` : ""}
                        </td>
                      ),
                      score: <td className={td} />,
                      source: <td className={`${td} text-dim`}>{ok ? `Tìm trên internet, ${viDate(cmp.data!.market.seen)}` : "Chưa có (đang phát triển)"}</td>,
                    };
                    return <Fragment key={c.key}>{mk[c.key]}</Fragment>;
                  })}
                </tr>
              </tbody>
            </table>
          )}
        </div>
        <Pager t={t} />
      </Panel>
      {product && <AddQuote ref={dlg} product={product} />}
    </>
  );
}

function AddQuote({ ref, product }: { ref: React.RefObject<HTMLDialogElement | null>; product: string }) {
  const qc = useQueryClient();
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => setErr(null), [product]);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    try {
      await addQuote({
        product, supplier_name: String(f.get("supplier")), supplier_tax_id: String(f.get("tax") || "") || undefined,
        price: Number(String(f.get("price")).replace(/\D/g, "")), quoted_at: String(f.get("date")),
        url: String(f.get("url") || "") || undefined,
      });
      await qc.invalidateQueries({ queryKey: ["prices"] });
      form.current?.reset();
      ref.current?.close();
    } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  }

  return (
    <dialog ref={ref} className="sheet">
      <form ref={form} onSubmit={submit} className="flex flex-col gap-3 p-5">
        <h2 className="text-lg font-semibold">Thêm báo giá</h2>
        <label className="text-[13px]">Nhà cung cấp<input name="supplier" required className="field mt-1" /></label>
        <label className="text-[13px]">Mã số thuế (nếu có)<input name="tax" className="field mt-1" inputMode="numeric" /></label>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-[13px]">Đơn giá (đ)<input name="price" required className="field mt-1 font-mono" inputMode="numeric" /></label>
          <label className="text-[13px]">Ngày báo giá<input name="date" type="date" required className="field mt-1"
            defaultValue={dayPlus(0)} /></label>
        </div>
        <label className="text-[13px]">Link trang giá (máy chủ sẽ mở để kiểm con số)<input name="url" type="url" className="field mt-1" /></label>
        {err && <p role="alert" className="text-sm text-late">{err}</p>}
        <div className="mt-1 flex justify-end gap-2">
          <button type="button" className="btn btn-quiet" onClick={() => ref.current?.close()}>Huỷ</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? "Đang lưu…" : "Lưu báo giá"}</button>
        </div>
      </form>
    </dialog>
  );
}

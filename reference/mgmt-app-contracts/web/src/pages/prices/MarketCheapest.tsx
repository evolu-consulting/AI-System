import { Fragment, useState, type ReactNode } from "react";
import { errText } from "@/api/client";
import { startMarketScan, useMarket, WHOLE_MARKET, type ScanJob } from "@/api/cksPrices";
import { ColumnPicker, Pager, TableTools, useColumns, useTable, type Column } from "@/components/table";
import { Empty, ErrorLine, Loading, Panel, Spinner, vnd, viDate } from "@/components/ui";
import { confirmDialog } from "@/components/dialog";

const th = "px-4 py-3 text-left text-xs font-semibold text-dim whitespace-nowrap sticky top-0 z-10 bg-sunk";
const num = "px-4 py-3 text-right font-mono text-[13.5px] tnum whitespace-nowrap";

const COLUMNS: Column[] = [
  { key: "ca", label: "Nhà cung cấp", locked: true }, { key: "min", label: "Rẻ nhất" }, { key: "new", label: "Cấp mới" },
  { key: "renew", label: "Gia hạn" }, { key: "where", label: "Nơi bán rẻ nhất" }, { key: "ours", label: "Mình đang nhập" },
];
const RIGHT = ["min", "new", "renew", "ours"];

/** Giá rẻ nhất thị trường (as on cks-demo): every CA's lowest verified public price for one term and device,
 *  next to what we pay; "Dò toàn thị trường" asks AI to survey them all again. */
export default function MarketCheapest({ jobs, write, onStarted, onClose }: { jobs: ScanJob[]; write: boolean; onStarted: () => void; onClose?: () => void }) {
  const [years, setYears] = useState(1);
  const [device, setDevice] = useState<"token" | "remote">("token");
  const q = useMarket(years, device);
  const t = useTable(q.data?.rows, { text: (r) => `${r.ca_name} ${r.ca} ${r.cheapest.seller}` });
  const cols = useColumns("market-cheapest", COLUMNS);
  const shown = COLUMNS.filter((c) => cols.shows(c.key));
  const [err, setErr] = useState<string | null>(null);
  const running = jobs.some((j) => j.ca === WHOLE_MARKET && j.years === years && j.device === device
    && (j.state === "queued" || j.state === "running"));
  const cheapestOurs = Math.min(...(q.data?.rows ?? []).filter((r) => r.ours != null).map((r) => r.ours!));

  async function scan() {
    if (!(await confirmDialog({ title: "Dò toàn thị trường?",
      body: "AI sẽ tìm giá công khai của mọi nhà cung cấp và mở lại từng trang để kiểm con số — mất khoảng 3–5 phút.",
      confirmLabel: "Dò ngay" }))) return;
    setErr(null);
    try { await startMarketScan(years, device); onStarted(); } catch (e) { setErr(errText(e)); }
  }

  return (
    <Panel className="flex flex-col xl:max-h-[72vh]">
      <div className="flex flex-wrap items-center gap-3 border-b border-rule px-5 py-3.5">
        <h2 className="text-[15px] font-semibold">Giá rẻ nhất thị trường</h2>
        <select aria-label="Thời hạn" value={years} onChange={(e) => setYears(Number(e.target.value))} className="field btn-sm h-9 w-auto">
          {[1, 2, 3].map((y) => <option key={y} value={y}>{y} năm</option>)}
        </select>
        <select aria-label="Thiết bị" value={device} onChange={(e) => setDevice(e.target.value as "token" | "remote")}
          className="field btn-sm h-9 w-auto">
          <option value="token">USB token</option><option value="remote">Ký từ xa</option>
        </select>
        <span className="ml-auto flex items-center gap-2">
          {write && (
            <button type="button" className="btn btn-sm btn-primary" disabled={running} onClick={scan}
              title="AI tìm giá công khai của mọi nhà cung cấp, máy chủ mở lại từng link để kiểm con số">
              {running ? "Đang dò toàn thị trường…" : "Dò toàn thị trường"}
            </button>
          )}
          {onClose && (
            <button type="button" aria-label="Đóng bảng thị trường" title="Đóng" onClick={onClose}
              className="grid h-8 w-8 place-items-center rounded-lg text-dim hover:bg-sunk hover:text-ink">✕</button>
          )}
        </span>
      </div>
      {running && (
        <div className="flex items-center gap-2 border-b border-rule px-5 py-2.5 text-[13px] text-act" role="status">
          <Spinner className="h-4 w-4" /> Đang dò toàn thị trường, khoảng 3–5 phút…
        </div>
      )}
      {err && <p role="alert" className="px-5 pt-3 text-sm text-late">{err}</p>}
      <div className="px-5 pt-3.5">
        <TableTools q={t.q} setQ={t.setQ} total={t.total} placeholder="Tìm theo nhà cung cấp, nơi bán…">
          <span className="max-sm:hidden"><ColumnPicker cols={cols} /></span>
        </TableTools>
      </div>
      <div className="overflow-auto xl:min-h-0 xl:flex-1">
      {q.isLoading ? <Loading /> : q.error ? <ErrorLine error={q.error} /> : !q.data?.rows.length ? (
        <Empty title="Chưa có giá đã kiểm cho gói này">Bấm “Dò toàn thị trường” để AI tìm giá của mọi nhà cung cấp.</Empty>
      ) : !t.total ? (
        <Empty title="Không có nhà cung cấp nào khớp">Thử từ khoá khác.</Empty>
      ) : (
        <table className="w-full" style={{ minWidth: Math.max(420, shown.length * 127) }}>
          <thead className="bg-sunk"><tr>
            {shown.map((c) => <th key={c.key} className={`${th} ${RIGHT.includes(c.key) ? "text-right" : ""}`}>{c.label}</th>)}
          </tr></thead>
          <tbody>
            {t.shown.map((r) => {
              const i = q.data.rows.indexOf(r); // rank in the full list, not on this page
              const cell: Record<string, ReactNode> = {
                ca: (
                <td className="px-4 py-3">
                  <span className="block text-[14px] font-semibold">{r.ca_name}</span>
                  <span className="block text-[12.5px] text-dim">
                    {i === 0 && <b className="font-semibold text-act">rẻ nhất · </b>}
                    {r.n} nguồn{!r.known && <b className="font-semibold text-soon"> · nhà cung cấp mới</b>}
                  </span>
                </td>
                ),
                min: <td className={`${num} font-semibold`}>{vnd(r.min)}</td>,
                new: <td className={`${num} text-dim`}>{vnd(r.min_new)}</td>,
                renew: <td className={`${num} text-dim`}>{vnd(r.min_renew)}</td>,
                where: (
                <td className="px-4 py-3 text-[13px]">
                  {r.cheapest.url ? <a href={r.cheapest.url} target="_blank" rel="noreferrer noopener"
                    className="text-act underline underline-offset-2">{r.cheapest.seller}</a> : r.cheapest.seller}
                  <span className="block text-[12px] text-dim">
                    {r.cheapest.tier === "official" ? "trang chính hãng" : "đại lý"}{r.cheapest.kind === "renew" ? " · giá gia hạn" : r.cheapest.kind === "new" ? " · giá cấp mới" : ""}
                  </span>
                </td>
                ),
                ours: (
                <td className={`${num} ${r.ours != null && r.ours === cheapestOurs ? "text-act font-semibold" : ""}`}>
                  {r.ours != null ? vnd(r.ours) : <span className="font-sans text-[12.5px] text-dim">chưa nhập</span>}
                </td>
                ),
              };
              return (
              <tr key={r.ca} className={`border-t border-rule-soft ${i === 0 ? "bg-ok-bg/60" : ""}`}>
                {shown.map((c) => <Fragment key={c.key}>{cell[c.key]}</Fragment>)}
              </tr>
              );
            })}
          </tbody>
        </table>
      )}
      </div>
      <Pager t={t} />
      <p className="border-t border-rule-soft px-5 py-3 text-[12.5px] text-dim">
        Giá chưa VAT, chỉ tính nguồn máy chủ đã thấy đúng con số trên trang{q.data?.market_seen ? `, mới nhất ngày ${viDate(q.data.market_seen)}` : ""}.
        Giá đại lý có thể là giá khuyến mãi; hỏi trợ lý để so chi tiết.
      </p>
    </Panel>
  );
}

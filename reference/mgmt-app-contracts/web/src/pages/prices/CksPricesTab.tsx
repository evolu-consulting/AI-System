import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { errText } from "@/api/client";
import { startScan, useCksPrices, useScans, WHOLE_MARKET, type PackageFilter, type PackageRow, type ScanJob } from "@/api/cksPrices";
import MarketCheapest from "./MarketCheapest";
import { canWrite, useMe } from "@/api/session";
import { ColumnFilters, ColumnPicker, Pager, TableTools, useColumns, useTable, type Column } from "@/components/table";
import { Chips, Empty, ErrorLine, Loading, Panel, Stat, vnd, viDate } from "@/components/ui";
import { confirmDialog } from "@/components/dialog";

const active = (j: ScanJob) => j.state === "queued" || j.state === "running";
const same = (j: ScanJob, r: PackageRow) => j.ca === r.ca && j.years === r.years && j.device === r.device;

/** The latest "Dò giá" runs: what is going on now, and how the last ones ended. A run cut off by a server restart
 *  (a deploy) is not the person's doing and tells them nothing: it is left out, and "Dò giá" can simply be pressed again. */
function ScanStrip({ jobs }: { jobs: ScanJob[] }) {
  const shown = jobs.filter((j) => j.state !== "interrupted"
    && (active(j) || Date.now() - Date.parse(j.created_at) < 6 * 3600e3)).slice(0, 3);
  if (!shown.length) return null;
  return (
    <ul className="mb-4 flex flex-col gap-1.5 text-[13px]" aria-live="polite">
      {shown.map((j) => (
        <li key={j.id} className={`rounded-lg border px-3 py-2 ${active(j) ? "border-act-line bg-act-soft text-act"
          : j.state === "done" ? "border-rule bg-panel text-ink-2" : "border-late-line bg-late-bg text-late"}`}>
          <b className="font-semibold">{j.ca === WHOLE_MARKET ? "Dò toàn thị trường" : `Dò giá ${j.ca}`} · {j.years} năm · {j.device === "remote" ? "ký từ xa" : "USB token"}</b>
          {" — "}
          {active(j) ? "AI đang tìm trên internet và máy chủ mở lại từng link để kiểm con số (khoảng 3–5 phút)…"
            : j.state === "done" ? `xong: tìm thấy ${j.n_found} nguồn, ${j.n_verified} nguồn thấy đúng con số trên trang.`
            : j.error ?? "không xong."}
        </li>
      ))}
    </ul>
  );
}

/** "12,5 tr" for the stat cards. */
const tr = (n: number) => `${(n / 1e6).toLocaleString("vi-VN", { maximumFractionDigits: 2, minimumFractionDigits: 1 })} tr`;

const th = "px-4 py-3 text-left text-xs font-semibold text-dim whitespace-nowrap sticky top-0 z-10 bg-sunk";
const num = "px-4 py-3.5 text-right font-mono text-[13.5px] tnum whitespace-nowrap";

// "Giá đại lý khác" is locked: it holds the "Dò giá" button, hiding it would take the action away.
const COLUMNS: Column[] = [
  { key: "pkg", label: "Gói", locked: true }, { key: "buy", label: "Giá mua" }, { key: "sell", label: "Giá bán" },
  { key: "margin", label: "Lãi / chữ ký" }, { key: "pct", label: "Biên lãi" },
  { key: "market", label: "Giá đại lý khác", locked: true }, { key: "sold", label: "Đã bán" },
];
const RIGHT = ["buy", "sell", "margin", "market", "sold"];

function rowTone(r: PackageRow) {
  if (r.flags.includes("above_market")) return "bg-soon-bg/60";
  if (r.flags.includes("cheapest_buy")) return "bg-ok-bg/60";
  return "";
}

/** So sánh giá · Chữ ký số: mua – bán — per package, what we pay, what we charge, and what others ask. */
export default function CksPricesTab() {
  const [f, setF] = useState<PackageFilter>("all");
  const q = useCksPrices(f);
  const s = q.data?.stats;
  const t = useTable(q.data?.rows, {
    text: (r) => `${r.label} ${r.device_label} ${(r.market?.sources ?? []).map((x) => x.seller).join(" ")}`,
    filters: [{ key: "device", label: "Thiết bị", value: (r) => r.device_label }],
  });
  const { data: me } = useMe();
  const write = canWrite(me);
  const scans = useScans();
  const jobs = scans.data ?? [];
  const qc = useQueryClient();
  const [scanErr, setScanErr] = useState<string | null>(null);
  const [showMarket, setShowMarket] = useState(false);     // the market table opens to the right on request
  const running = useRef(0);
  const cols = useColumns("cks-prices", COLUMNS);
  const shown = COLUMNS.filter((c) => cols.shows(c.key));

  // a scan just finished: its prices are in, read the table again
  const nActive = jobs.filter(active).length;
  useEffect(() => {
    if (nActive < running.current) void qc.invalidateQueries({ queryKey: ["prices", "cks"] });
    running.current = nActive;
  }, [nActive, qc]);

  async function scan(r: PackageRow) {
    if (!(await confirmDialog({ title: `Dò giá ${r.ca}?`,
      body: "AI tìm giá công khai của nhà cung cấp này và mở lại từng trang để kiểm con số — khoảng 3–5 phút.",
      confirmLabel: "Dò ngay" }))) return;
    setScanErr(null);
    try { await startScan(r.ca, r.years, r.device); await scans.refetch(); }
    catch (e) { setScanErr(errText(e)); }
  }

  return (
    <>
      <div className="mb-5 grid grid-cols-4 gap-3 max-md:grid-cols-2">
        <Stat value={s?.sold_12m ?? "–"} label="Chữ ký đã bán · 12 tháng" />
        <Stat value={s ? <span className="font-mono">{tr(s.revenue)}</span> : "–"} label="Doanh thu" />
        <div className="rounded-xl border border-act-line bg-act-soft px-4 py-3.5 text-act">
          <p className="tnum font-mono text-[26px] leading-tight font-medium">{s ? tr(s.gross_profit) : "–"}</p>
          <p className="text-[13px]">Lãi gộp</p>
        </div>
        <Stat value={s?.margin_pct != null ? `${s.margin_pct.toLocaleString("vi-VN")}%` : "–"} label="Biên lãi trung bình" />
      </div>

      <Chips label="Lọc gói" value={f} onChange={setF}
        items={[{ id: "all", label: "Mọi gói" }, { id: "1y", label: "1 năm" }, { id: "multi", label: "Nhiều năm" },
          { id: "token", label: "USB token" }, { id: "remote", label: "Ký từ xa" }]} />
      <TableTools q={t.q} setQ={t.setQ} total={t.total} placeholder="Tìm theo gói, nhà cung cấp…">
        <ColumnFilters filter={t.filter} />
        <span className="max-sm:hidden"><ColumnPicker cols={cols} /></span>
      </TableTools>
      <ScanStrip jobs={jobs} />
      {scanErr && <p role="alert" className="mb-3 text-sm text-late">{scanErr}</p>}

      <div className={`grid items-stretch gap-4 ${showMarket ? "xl:grid-cols-2" : "grid-cols-1"}`}>
      <Panel className={showMarket ? "xl:flex xl:flex-col xl:max-h-[72vh]" : "overflow-x-auto"}>
        <div className="flex flex-wrap items-center gap-3 border-b border-rule px-5 py-3.5">
          <h2 className="text-[15px] font-semibold">Chữ ký số của tôi</h2>
          <p className="text-[12.5px] text-dim max-xl:hidden">Giá mua từ hợp đồng mua vào, giá bán từ hợp đồng bán ra · đơn vị đồng</p>
          {!showMarket && (
            <button type="button" className="btn btn-outline btn-sm ml-auto" onClick={() => setShowMarket(true)}>
              Kiểm tra thị trường
            </button>
          )}
        </div>
        <div className={showMarket ? "overflow-auto xl:min-h-0 xl:flex-1" : "overflow-x-auto"}>
        {q.isLoading ? <Loading /> : q.error ? <ErrorLine error={q.error} /> : !q.data?.rows.length ? (
          <Empty title="Chưa có gói nào">Nhập lô mua và tạo hợp đồng bán ở trang Sản phẩm › Chữ ký số.</Empty>
        ) : !t.total ? (
          <Empty title="Không có gói nào khớp">Thử từ khoá khác.</Empty>
        ) : (
          <table className="w-full" style={{ minWidth: Math.max(480, shown.length * 117) }}>
            <thead className="bg-sunk"><tr>
              {shown.map((c) => <th key={c.key} className={`${th} ${RIGHT.includes(c.key) ? "text-right" : ""}`}>{c.label}</th>)}
            </tr></thead>
            <tbody>
              {t.shown.map((r) => {
                const cheap = r.flags.includes("cheapest_buy");
                const above = r.flags.includes("above_market");
                const cell: Record<string, ReactNode> = {
                  pkg: (
                    <td className="px-4 py-3">
                      <span className="block text-[14px] font-semibold">{r.label}</span>
                      <span className="block text-[12.5px] text-dim">
                        {r.device_label}
                        {cheap && <b className="font-semibold text-act"> · giá mua thấp nhất</b>}
                      </span>
                      {above && <span className="block text-[12.5px] font-semibold text-soon">Bán cao hơn thị trường</span>}
                    </td>
                  ),
                  buy: <td className={`${num} ${cheap ? "font-semibold text-act underline decoration-1 underline-offset-4" : ""}`}>{vnd(r.buy)}</td>,
                  sell: <td className={`${num} ${above ? "font-semibold text-soon underline decoration-1 underline-offset-4" : ""}`}>{vnd(r.sell)}</td>,
                  margin: <td className={num}>{vnd(r.margin)}</td>,
                  pct: (
                    <td className="px-4 py-3.5">
                      {r.margin_pct != null && (
                        <span className="flex items-center gap-2 font-mono text-[13px]">
                          {r.margin_pct}%
                          <span className="h-1.5 w-12 rounded-full bg-idle-bg">
                            <span className="block h-1.5 rounded-full bg-act" style={{ width: `${Math.min(100, r.margin_pct * 2)}%` }} />
                          </span>
                        </span>
                      )}
                    </td>
                  ),
                  market: (
                    <td className={`${num} text-dim`} title={r.market?.sources.map((x) => `${x.seller}: ${vnd(x.price)}`).join("\n")}>
                      {r.market ? (r.market.min === r.market.max ? vnd(r.market.min) : `${vnd(r.market.min)}–${vnd(r.market.max)}`) : "—"}
                      {r.market?.any_device && <span className="block font-sans text-[11px]">mọi loại thiết bị</span>}
                      {write && (jobs.some((j) => active(j) && same(j, r))
                        ? <span className="mt-1 block font-sans text-[12px] text-act">Đang dò…</span>
                        : <button type="button" className="mt-1 font-sans text-[12px] text-act underline underline-offset-2"
                            onClick={() => scan(r)} title="AI tìm giá của các nơi bán khác trên internet">Dò giá</button>)}
                    </td>
                  ),
                  sold: <td className={num}>{r.sold}</td>,
                };
                return (
                  <tr key={r.label + r.device} className={`border-t border-rule-soft ${rowTone(r)}`}>
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
          Giá đại lý khác: tìm trên internet{q.data?.market_seen ? ` ngày ${viDate(q.data.market_seen)}` : ""}, giá chưa VAT, chỉ để tham khảo.
          Rê chuột lên khoảng giá để xem từng nguồn; hỏi trợ lý để so sánh chi tiết.
        </p>
      </Panel>
      {showMarket && <MarketCheapest jobs={jobs} write={write} onStarted={() => void scans.refetch()} onClose={() => setShowMarket(false)} />}
      </div>
    </>
  );
}

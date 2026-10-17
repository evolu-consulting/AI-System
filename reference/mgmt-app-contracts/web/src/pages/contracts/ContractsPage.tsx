import { Fragment, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { createCategory, deleteContract, uploadContract, useBoard, useCategories, type BoardRow } from "@/api/board";
import { errText } from "@/api/client";
import { canWrite, isOwner, useMe } from "@/api/session";
import { ColumnFilters, ColumnPicker, Pager, TableTools, useColumns, useTable, type Column } from "@/components/table";
import { Empty, ErrorLine, Loading, PageHead, Panel, TONE_TEXT, vnd } from "@/components/ui";
import { confirmDialog, promptDialog } from "@/components/dialog";
import { toast } from "@/components/toast";
import { IconTrash } from "@/components/icons";

const COLUMNS: Column[] = [
  { key: "title", label: "Hợp đồng", locked: true }, { key: "seller", label: "Bên bán" }, { key: "buyer", label: "Bên mua" },
  { key: "value", label: "Giá trị" }, { key: "signers", label: "Người ký" }, { key: "owner", label: "Phụ trách" },
  { key: "status", label: "Trạng thái" },
  { key: "what", label: "Loại hàng" },
];

/** "Nguyễn Văn A – Giám đốc" → "Nguyễn Văn A": a person filters by name, whatever the title written. */
const personOf = (s: string) => s.split(/\s[–-]\s|,/)[0].trim();

/** The status column grouped for filtering. "Sắp đáo hạn": ends within 60 days (the app's first reminder) or the
 *  notice period has started — what a person means by it, not only what is already urgent. */
const SOON_DAYS = 60;
function stateOf(r: BoardRow): string {
  // grouped on the server's status code, never on its colour (a read error is red too, a paid lot grey)
  const fixed: Record<string, string> = { review: "Chờ xác nhận", reading: "Đang đọc", failed: "Đọc lỗi", expired: "Đã hết hạn",
    cks_expired: "Đã hết hạn", handled: "Đã xử lý", paid: "Đã xử lý", soon: "Sắp đáo hạn", cks_soon: "Sắp đáo hạn" };
  if (r.status.code && fixed[r.status.code]) return fixed[r.status.code];
  const left = r.end ? (Date.parse(r.end) - Date.now()) / 86_400_000 : Infinity;
  return left >= 0 && left <= SOON_DAYS ? "Sắp đáo hạn" : "Đang hiệu lực";
}

const LEGAL =/\b(công ty|cong ty|cty|tnhh|cổ phần|co phan|cp|một thành viên|mtv|hộ kinh doanh|hkd)\b\.?/giu;

/** "CÔNG TY TNHH BAO BÌ PHƯƠNG NAM" → "Bao Bì Phương Nam": the legal form takes the narrow column's room; the full
 *  name stays in the tooltip. */
function shortName(name: string | null): string {
  if (!name) return "—";
  let s = name.replace(LEGAL, " ").replace(/\s+/g, " ").trim() || name;
  if (s === s.toUpperCase()) s = s.toLowerCase().replace(/(^|\s)\p{L}/gu, (c) => c.toUpperCase());
  return s;
}

/** What a contract is about: its product tags, or for a CKS contract the link to its signatures / stock. */
function What({ r, nav }: { r: BoardRow; nav: (to: string) => void }) {
  if (r.cks) {
    return (
      <span className="flex flex-col items-start gap-0.5 text-[13px]">
        <span className="text-dim">Chữ ký số</span>
        <span className="text-act underline underline-offset-2"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); nav(r.cks!.href); }}>{r.cks.label}</span>
      </span>
    );
  }
  return (
    <span className="flex flex-wrap gap-1.5">
      {r.tags.map((x) => <span key={x.label} className={`tag ${x.grey ? "tag-grey" : ""}`}>{x.label}</span>)}
    </span>
  );
}

/** p01 · Hợp đồng: category chips, then a table — who sells, who buys, how much, who is in charge, what, status. */
export default function ContractsPage() {
  const { data: me } = useMe();
  const cats = useCategories();
  const board = useBoard("all");          // categories are filtered here, with the other columns
  const catName = new Map((cats.data ?? []).map((c) => [c.id, c.name]));
  const write = canWrite(me);
  const owner = isOwner(me);
  const qc = useQueryClient();
  const nav = useNavigate();
  const file = useRef<HTMLInputElement>(null);
  const [err, setErr] = useState<string | null>(null);

  async function onDelete(r: BoardRow, e?: { preventDefault(): void; stopPropagation(): void }) {
    e?.preventDefault(); e?.stopPropagation();
    const ok = await confirmDialog({ title: "Xoá hợp đồng?", danger: true, confirmLabel: "Xoá",
      body: <>“{r.title}” sẽ bị xoá khỏi tổ chức, cùng lịch nhắc và dữ liệu liên quan. Không thể hoàn tác.</> });
    if (!ok) return;
    try { await deleteContract(r.id); await qc.invalidateQueries({ queryKey: ["board"] }); toast("Đã xoá hợp đồng"); }
    catch (e) { setErr(errText(e)); }
  }

  async function addCategory() {
    const name = await promptDialog({ title: "Thêm loại hàng", label: "Tên loại mới",
      placeholder: "Vd: Bao bì, Gia vị…", required: true, maxLength: 50, confirmLabel: "Thêm" });
    if (!name) return;
    try { await createCategory(name); await qc.invalidateQueries({ queryKey: ["categories"] }); toast("Đã thêm loại hàng"); }
    catch (e) { setErr(errText(e)); }
  }

  async function onFile(f: File | undefined) {
    if (!f) return;
    try { const r = await uploadContract(f); nav(`/contracts/${r.id}`); }
    catch (e) { setErr(errText(e)); }
  }

  const t = useTable(board.data, {
    key: "contracts",          // the assistant can filter this table (filter_table) and sees what it shows
    describe: (r) => [r.number ?? r.title, r.title, `bán ${shortName(r.seller)}`, `mua ${shortName(r.buyer)}`,
      r.value != null ? `${vnd(r.value)} đ` : null, `loại ${r.category_ids.map((id) => catName.get(id)).filter(Boolean).join("/") || "—"}`,
      r.status.label, `id ${r.id}`].filter(Boolean).join(" · "),
    text: (r) => [r.title, r.number, r.seller, r.buyer, r.owner, r.party, r.sub, r.cks?.label, r.status.label,
      ...r.tags.map((x) => x.label)].filter(Boolean).join(" "),
    filters: [
      { key: "category", label: "Loại hàng", value: (r) => r.category_ids.map((id) => catName.get(id) ?? "").filter(Boolean),
        extra: write && <button type="button" className="text-[12.5px] font-medium text-act hover:underline" onClick={addCategory}>+ Loại mới</button> },
      { key: "direction", label: "Mua / bán", value: (r) => r.direction === "sale" ? "Bán ra" : r.direction === "purchase" ? "Mua vào" : "Chưa rõ" },
      { key: "seller", label: "Bên bán", value: (r) => r.seller && shortName(r.seller) },
      { key: "buyer", label: "Bên mua", value: (r) => r.buyer && shortName(r.buyer) },
      { key: "owner", label: "Phụ trách", value: (r) => r.owner },
      { key: "signer", label: "Người ký", value: (r) => [r.seller_signer, r.buyer_signer].filter(Boolean).map((s) => personOf(s!)) },
      { key: "status", label: "Trạng thái", value: stateOf },
      { key: "value", label: "Giá trị (đ)", kind: "number", value: (r) => r.value },
    ],
  });
  const cols = useColumns("contracts", COLUMNS);
  const cell: Record<string, (r: BoardRow) => ReactNode> = {
    title: (r) => (
      <td className="max-w-[240px] px-3 py-3 pl-5">
        <Link to={`/contracts/${r.id}`} className="block truncate font-semibold" title={r.title}
          onClick={(e) => e.stopPropagation()}>{r.title}</Link>
        <span className="block truncate text-[12.5px] text-dim">{[r.number, r.sub].filter(Boolean).join(" · ")}</span>
      </td>
    ),
    seller: (r) => <td className="min-w-[130px] px-3 py-3" title={r.seller ?? undefined}><span className="line-clamp-2">{shortName(r.seller)}</span></td>,
    buyer: (r) => <td className="min-w-[130px] px-3 py-3" title={r.buyer ?? undefined}><span className="line-clamp-2">{shortName(r.buyer)}</span></td>,
    value: (r) => <td className="px-3 py-3 text-right font-mono whitespace-nowrap">{r.value != null ? `${vnd(r.value)} đ` : "—"}</td>,
    signers: (r) => (
      <td className="min-w-[170px] px-3 py-3 text-[13px]">
        {r.seller_signer || r.buyer_signer ? (
          <>
            <span className="block truncate" title={r.seller_signer ?? undefined}><span className="text-dim">Bán · </span>{r.seller_signer ?? "—"}</span>
            <span className="block truncate" title={r.buyer_signer ?? undefined}><span className="text-dim">Mua · </span>{r.buyer_signer ?? "—"}</span>
          </>
        ) : <span className="text-dim">—</span>}
      </td>
    ),
    owner: (r) => <td className="max-w-[140px] truncate px-3 py-3" title={r.owner ?? undefined}>{r.owner ?? "—"}</td>,
    status: (r) => <td className={`px-3 py-3 whitespace-nowrap ${TONE_TEXT[r.status.tone]}`}>{r.status.label}</td>,
    what: (r) => <td className="min-w-[200px] px-3 py-3 pr-5"><What r={r} nav={nav} /></td>,
  };
  const shown = COLUMNS.filter((c) => cols.shows(c.key)).map((c) => ({ ...c, cell: cell[c.key] }));

  return (
    <>
      <PageHead title="Hợp đồng" titleMobileOnly actions={write && (
        <>
          <input ref={file} type="file" hidden accept=".pdf,.docx,.doc,.png,.jpg,.jpeg,.md,.txt"
            onChange={(e) => { const picked = e.target.files?.[0]; e.target.value = ""; void onFile(picked); }} />
          <Link to="/contracts/new" className="btn btn-outline">Nhập tay</Link>
          <button type="button" className="btn btn-primary" onClick={() => file.current?.click()}>+ Thêm hợp đồng</button>
        </>
      )} />
      {err &&<p role="alert" className="mb-3 text-sm text-late">{err}</p>}

      <TableTools q={t.q} setQ={t.setQ} total={t.total} placeholder="Tìm theo tên, đối tác, số HĐ, loại…">
        <ColumnFilters filter={t.filter} />
        <span className="max-sm:hidden"><ColumnPicker cols={cols} /></span>
      </TableTools>
      <Panel className="md:flex md:min-h-0 md:flex-1 md:flex-col">
        {board.isLoading ? <Loading /> : board.error ? <ErrorLine error={board.error} /> : !board.data?.length ? (
          <Empty title="Chưa có hợp đồng">Bấm “+ Thêm hợp đồng”, hoặc kéo thả file vào ô trợ lý bên phải.</Empty>
        ) : !t.total ? (
          <Empty title="Không có hợp đồng khớp">Thử từ khoá khác.</Empty>
        ) : (
          <>
            {/* wide screens: one column per fact, scrolling sideways when the assistant panel leaves little room */}
            <div className="overflow-auto max-sm:hidden md:min-h-0 md:flex-1">
              <table className="w-full text-[13.5px]" style={{ minWidth: Math.max(560, shown.length * 135) }}>
                <thead className="text-left text-[12px] text-dim">
                  <tr>
                    {shown.map((c) => (
                      <th key={c.key} className={`sticky top-0 z-10 border-b border-rule bg-panel px-3 py-2.5 font-medium first:pl-5 last:pr-5 ${c.key === "value" ? "text-right" : ""}`}>{c.label}</th>
                    ))}
                    {owner && <th className="sticky top-0 z-10 w-10 border-b border-rule bg-panel px-3 py-2.5 pr-5" aria-label="Hành động" />}
                  </tr>
                </thead>
                <tbody>
                  {t.shown.map((r) => (
                    <tr key={r.id} onClick={() => nav(`/contracts/${r.id}`)}
                      className="cursor-pointer border-b border-rule-soft align-top last:border-0 hover:bg-sunk">
                      {shown.map((c) => <Fragment key={c.key}>{c.cell(r)}</Fragment>)}
                      {owner && (
                        <td className="px-3 py-3 pr-5 text-right align-middle">
                          <button type="button" aria-label={`Xoá ${r.title}`} title="Xoá hợp đồng" onClick={(e) => onDelete(r, e)}
                            className="grid h-8 w-8 place-items-center rounded-lg text-dim hover:bg-late-bg hover:text-late">
                            <IconTrash width={17} height={17} />
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* phones: a card per contract */}
            <ul className="sm:hidden">
              {t.shown.map((r) => (
                <li key={r.id} className="relative border-b border-rule-soft last:border-0">
                  <Link to={`/contracts/${r.id}`} className={`flex flex-col gap-1.5 px-4 py-3.5 hover:bg-sunk ${owner ? "pr-12" : ""}`}>
                    <span className="truncate font-semibold">{r.title}</span>
                    <span className="text-[13px] text-dim">{[r.seller, r.buyer].filter(Boolean).map(shortName).join(" → ")}</span>
                    <span className="text-[13px] text-dim">
                      {[r.value != null ? `${vnd(r.value)} đ` : null, r.owner && `Phụ trách: ${r.owner}`].filter(Boolean).join(" · ")}
                    </span>
                    <What r={r} nav={nav} />
                    <span className={`text-[13.5px] ${TONE_TEXT[r.status.tone]}`}>{r.status.label}</span>
                  </Link>
                  {owner && (
                    <button type="button" aria-label={`Xoá ${r.title}`} title="Xoá hợp đồng" onClick={(e) => onDelete(r, e)}
                      className="absolute top-3 right-2 grid h-9 w-9 place-items-center rounded-lg text-dim hover:bg-late-bg hover:text-late">
                      <IconTrash width={18} height={18} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
        <Pager t={t} />
      </Panel>
    </>
  );
}

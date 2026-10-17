import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

/** Lower-case, accent-free text so "Hà Nội" matches "ha noi" and "Đức" matches "duc". */
export function normalize(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").toLowerCase();
}

/** Every word of the query must appear somewhere in the row text. An empty query matches all. */
export function matches(haystack: string, query: string): boolean {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const h = normalize(haystack);
  return words.every((w) => h.includes(w));
}

/** Page count (at least 1) and the slice for a 1-based page, clamped into range. */
export function paginate<T>(rows: T[], page: number, pageSize: number) {
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const p = Math.min(Math.max(1, page), pages);
  return { pages, page: p, shown: rows.slice((p - 1) * pageSize, p * pageSize) };
}

type Vals = string | string[] | number | null | undefined;
/** A column people may filter on. "values": its choices are the values it holds in the rows (a row may hold several:
 *  a contract in two categories), picking several keeps rows holding any. "number": a from–to range. `extra` goes
 *  under the choices (e.g. "+ Loại mới"). */
export type ColumnFilter<T> = { key: string; label: string; value: (r: T) => Vals; kind?: "values" | "number"; extra?: ReactNode };
/** One condition the person added: any of these values, or a range. */
export type Cond = { in?: string[]; min?: number | null; max?: number | null };
export type FilterState = {
  defs: { key: string; label: string; kind: "values" | "number"; options: string[]; extra?: ReactNode }[];
  /** the conditions in the order they were added (a field added with nothing chosen yet still shows) */
  active: string[];
  conds: Record<string, Cond>;
  add: (key: string) => void;
  set: (key: string, c: Cond) => void;
  remove: (key: string) => void;
  clear: () => void;
};

const list = (v: Vals): string[] => (Array.isArray(v) ? v : typeof v === "string" ? [v] : []).filter((x) => x && x.trim());

/** The distinct, non-empty values of a column, sorted the Vietnamese way. */
export function optionsOf<T>(rows: T[], value: (r: T) => Vals): string[] {
  return [...new Set(rows.flatMap((r) => list(value(r))))].sort((a, b) => a.localeCompare(b, "vi"));
}

/** A condition that constrains anything (an added field with nothing chosen yet does not). */
export const isSet = (c: Cond | undefined) => !!c && (!!c.in?.length || c.min != null || c.max != null);

/** Rows passing every set condition. */
export function applyFilters<T>(rows: T[], filters: ColumnFilter<T>[], conds: Record<string, Cond>): T[] {
  return filters.reduce((acc, f) => {
    const c = conds[f.key];
    if (!isSet(c)) return acc;
    if (f.kind === "number") {
      return acc.filter((r) => {
        const n = f.value(r);
        return typeof n === "number" && (c.min == null || n >= c.min) && (c.max == null || n <= c.max);
      });
    }
    return acc.filter((r) => list(f.value(r)).some((v) => c.in!.includes(v)));
  }, rows);
}

/** The assistant's "lọc giúp": a table, its page, the conditions in the person's words and an optional search. */
export type TableFilterCard = {
  type: "filter"; table: string; path: string; title: string; q?: string | null;
  conds: Record<string, { in?: string[]; min?: number | null; max?: number | null }>;
};
export const TABLE_FILTER_EVENT = "table:filter";
const waiting = new Map<string, TableFilterCard>();     // kept until that table is on screen with its rows

/** Go to the table's page and filter it as the assistant asked (the chips can then be changed by hand). */
export function applyTableFilter(card: TableFilterCard, navigate: (to: string) => void) {
  waiting.set(card.table, card);
  navigate(card.path);
  window.dispatchEvent(new Event(TABLE_FILTER_EVENT));
}

/** "nhua dong a" → the option "Nhựa Đông Á": the same words, else one containing the other. */
export function resolveValues(asked: string[], options: string[]): string[] {
  const out = new Set<string>();
  for (const a of asked) {
    const n = normalize(a).trim();
    const exact = options.find((o) => normalize(o) === n);
    const hits = exact ? [exact] : options.filter((o) => normalize(o).includes(n) || n.includes(normalize(o)));
    hits.forEach((h) => out.add(h));
  }
  return [...out];
}

/** What each table on screen shows right now, in words, sent with the person's question to the assistant
 *  ("hợp đồng này" = the rows they are looking at). Keyed by table. */
export const tableViews = new Map<string, string>();
const VIEW_ROWS = 60;

export function useTable<T>(rows: T[] | undefined, opts: {
  text: (r: T) => string; pageSize?: number; key?: string; filters?: ColumnFilter<T>[];
  /** one line per row for the assistant's view of the table ("09/2026/HĐMB-PN2 · Bao Bì Phương Nam · 91.500.000 đ") */
  describe?: (r: T) => string;
}) {
  const { text, pageSize = 20, filters = [], key, describe } = opts;
  const [q, setQState] = useState("");
  const [page, setPage] = useState(1);
  const [conds, setConds] = useState<Record<string, Cond>>({});
  const [active, setActive] = useState<string[]>([]);

  // a filter the assistant set for this table: applied once its rows are here
  useEffect(() => {
    if (!key) return;
    const take = () => {
      const card = waiting.get(key);
      if (!card || !rows) return;
      waiting.delete(key);
      const next: Record<string, Cond> = {};
      for (const f of filters) {
        const c = card.conds[f.key];
        if (!c) continue;
        if (f.kind === "number") next[f.key] = { min: c.min ?? null, max: c.max ?? null };
        else next[f.key] = { in: resolveValues(c.in ?? [], optionsOf(rows, f.value)) };
      }
      setConds(next);
      setActive(Object.keys(next));
      setQState(card.q ?? "");
      setPage(1);
    };
    take();
    window.addEventListener(TABLE_FILTER_EVENT, take);
    return () => window.removeEventListener(TABLE_FILTER_EVENT, take);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, rows]);
  const filtered = useMemo(() => {
    const kept = applyFilters(rows ?? [], filters, conds);
    return normalize(q).trim() ? kept.filter((r) => matches(text(r), q)) : kept;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, q, conds]);
  const [size, setSizeState] = useState(pageSize);
  const p = paginate(filtered, page, size);
  const setQ = (v: string) => { setQState(v); setPage(1); };
  const setPageSize = (n: number) => { setSizeState(n); setPage(1); };
  const filter: FilterState = {
    defs: filters.map((f) => ({ key: f.key, label: f.label, kind: f.kind ?? "values",
                                 options: f.kind === "number" ? [] : optionsOf(rows ?? [], f.value), extra: f.extra })),
    active, conds,
    add: (key) => setActive((a) => (a.includes(key) ? a : [...a, key])),
    set: (key, c) => { setConds((was) => ({ ...was, [key]: c })); setPage(1); },
    remove: (key) => {
      setActive((a) => a.filter((k) => k !== key));
      setConds((was) => { const { [key]: _, ...rest } = was; return rest; });
      setPage(1);
    },
    clear: () => { setActive([]); setConds({}); setPage(1); },
  };
  // the table as the person sees it, for the assistant: filters, search, how many rows, and the rows on screen
  useEffect(() => {
    if (!key || !describe) return;
    const label = new Map(filters.map((f) => [f.key, f.label]));
    const said = active.filter((k) => isSet(conds[k])).map((k) => {
      const c = conds[k];
      const what = c.in?.length ? c.in.join(", ")
        : [c.min != null && `từ ${c.min}`, c.max != null && `đến ${c.max}`].filter(Boolean).join(" ");
      return `${label.get(k)}: ${what}`;
    });
    const head = `${filtered.length} dòng` + (said.length ? ` · lọc ${said.join("; ")}` : " · không lọc")
      + (q.trim() ? ` · tìm «${q.trim()}»` : "") + (p.pages > 1 ? ` · đang xem trang ${p.page}/${p.pages}` : "");
    // every row the filters keep (not only this page), so a question about "these" covers all of them; ▸ = on screen
    const onPage = new Set(p.shown);
    const lines = filtered.slice(0, VIEW_ROWS).map((r) => (onPage.has(r) ? "▸ " : "  ") + describe(r));
    if (filtered.length > VIEW_ROWS) lines.push(`… và ${filtered.length - VIEW_ROWS} dòng nữa`);
    tableViews.set(key, [head, ...lines].join("\n").slice(0, 7900));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, filtered, conds, active, q, p.page, size]);
  useEffect(() => () => { if (key) tableViews.delete(key); }, [key]);    // leaving the page: no stale view

  return { q, setQ, page: p.page, setPage, pages: p.pages, total: filtered.length, shown: p.shown, filter,
           pageSize: size, setPageSize };
}

/** A small panel under a pill button; closes on a click outside or Esc. */
function Pop({ button, children, align = "left", startOpen = false }: {
  button: (open: boolean, toggle: () => void) => ReactNode; children: ReactNode | ((close: () => void) => ReactNode);
  align?: "left" | "right"; startOpen?: boolean;
}) {
  const [open, setOpen] = useState(startOpen);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      {button(open, () => setOpen(!open))}
      {open && (
        <div className={`absolute z-30 mt-1.5 w-64 rounded-xl border border-rule bg-panel p-1.5 shadow-lg ${align === "right" ? "right-0" : "left-0"}`}>
          {typeof children === "function" ? children(() => setOpen(false)) : children}
        </div>
      )}
    </div>
  );
}

const PILL = "inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-[13px] whitespace-nowrap transition-colors";
const PILL_OFF = "border-rule bg-panel text-ink-2 hover:border-ink-2/30 hover:bg-sunk";
const PILL_ON = "border-act/40 bg-act-soft font-medium text-act";
const Caret = () => <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden className="opacity-60"><path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" strokeWidth="1.4" /></svg>;

type Def = FilterState["defs"][number];
const num = (n: number) => n.toLocaleString("vi-VN");

/** What a chip says after its column: the first value (+ how many more), or the range. */
function summary(def: Def, c: Cond | undefined): string {
  if (!isSet(c)) return "chọn…";
  if (def.kind === "number") {
    return c!.min != null && c!.max != null ? `${num(c!.min)} – ${num(c!.max)}` : c!.min != null ? `từ ${num(c!.min)}` : `đến ${num(c!.max!)}`;
  }
  return `${c!.in![0]}${c!.in!.length > 1 ? ` +${c!.in!.length - 1}` : ""}`;
}

/** Choices to tick (searchable when long). */
function ValuesEditor({ def, cond, set }: { def: Def; cond: Cond | undefined; set: (c: Cond) => void }) {
  const [find, setFind] = useState("");
  const chosen = cond?.in ?? [];
  const opts = def.options.filter((o) => matches(o, find));
  return (
    <>
      {def.options.length > 6 && (
        <input value={find} onChange={(e) => setFind(e.target.value)} placeholder={`Tìm ${def.label.toLowerCase()}…`}
          className="field mb-1 h-8 text-[13px]" autoFocus />
      )}
      <div className="max-h-64 overflow-y-auto">
        {opts.map((o) => (
          <label key={o} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-[13.5px] hover:bg-sunk">
            <input type="checkbox" checked={chosen.includes(o)} className="h-4 w-4 accent-[var(--color-act)]"
              onChange={() => set({ in: chosen.includes(o) ? chosen.filter((x) => x !== o) : [...chosen, o] })} />
            <span className="min-w-0 truncate" title={o}>{o}</span>
          </label>
        ))}
        {!opts.length && <p className="px-2 py-1.5 text-[13px] text-dim">Không có lựa chọn</p>}
      </div>
      {def.extra && <div className="mt-1 border-t border-rule-soft px-1 pt-1.5">{def.extra}</div>}
    </>
  );
}

/** From – to, for a number column (typed with or without thousand dots). */
function RangeEditor({ cond, set }: { cond: Cond | undefined; set: (c: Cond) => void }) {
  const parse = (s: string) => (s.replace(/\D/g, "") ? Number(s.replace(/\D/g, "")) : null);
  const box = (label: string, v: number | null | undefined, on: (n: number | null) => void) => (
    <label className="flex flex-1 flex-col gap-1 text-[12px] text-dim">{label}
      <input inputMode="numeric" className="field h-8 font-mono text-[13px]" value={v == null ? "" : num(v)}
        onChange={(e) => on(parse(e.target.value))} />
    </label>
  );
  return (
    <div className="flex gap-2 p-1">
      {box("Từ", cond?.min, (n) => set({ ...cond, min: n }))}
      {box("Đến", cond?.max, (n) => set({ ...cond, max: n }))}
    </div>
  );
}

/** An added condition: "Bên bán: Nhựa Đông Á +1 ×"; a click opens its editor, × takes it away. */
function CondChip({ def, cond, set, remove, fresh }: {
  def: Def; cond: Cond | undefined; set: (c: Cond) => void; remove: () => void; fresh: boolean;
}) {
  const on = isSet(cond);
  return (
    <Pop startOpen={fresh} button={(open, toggle) => (
      <span className={`${PILL} pr-1 ${on ? PILL_ON : PILL_OFF}`}>
        <button type="button" onClick={toggle} aria-expanded={open} aria-label={`Sửa lọc ${def.label}`} className="max-w-[220px] truncate">
          {def.label}: <span className={on ? "" : "text-dim"}>{summary(def, cond)}</span>
        </button>
        <button type="button" onClick={remove} aria-label={`Bỏ lọc ${def.label}`}
          className="grid h-6 w-6 place-items-center rounded-full text-[12px] opacity-70 hover:bg-black/5 hover:opacity-100">✕</button>
      </span>
    )}>
      {def.kind === "number" ? <RangeEditor cond={cond} set={set} /> : <ValuesEditor def={def} cond={cond} set={set} />}
    </Pop>
  );
}

export type Column = { key: string; label: string; locked?: boolean };

/** Which columns a table shows, chosen by the person and remembered in this browser (storage may be blocked: then
 *  every column shows). A locked column (the row's name) is always there. */
export function useColumns(storageKey: string, columns: Column[]) {
  const all = columns.map((c) => c.key);
  const [hidden, setHidden] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(`cols:${storageKey}`) ?? "[]").filter((k: string) => all.includes(k)); }
    catch { return []; }
  });
  const save = (h: string[]) => {
    setHidden(h);
    try { localStorage.setItem(`cols:${storageKey}`, JSON.stringify(h)); } catch { /* not kept */ }
  };
  return {
    columns,
    shows: (key: string) => !hidden.includes(key),
    toggle: (key: string) => save(hidden.includes(key) ? hidden.filter((k) => k !== key) : [...hidden, key]),
    reset: () => save([]),
    hiddenCount: hidden.length,
  };
}

/** "Cột ▾": a checkbox per column, in the same pill style as the filters. */
export function ColumnPicker({ cols }: { cols: ReturnType<typeof useColumns> }) {
  return (
    <Pop align="right" button={(open, toggle) => (
      <button type="button" onClick={toggle} aria-expanded={open} aria-label="Cột hiển thị"
        className={`${PILL} ${cols.hiddenCount ? PILL_ON : PILL_OFF}`}>
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden className="opacity-70"><path d="M1.5 2.5h11v9h-11zM5.2 2.5v9M8.8 2.5v9" fill="none" stroke="currentColor" strokeWidth="1.2" /></svg>
        Cột{cols.hiddenCount ? ` · ẩn ${cols.hiddenCount}` : ""}<Caret />
      </button>
    )}>
      {cols.columns.map((c) => (
        <label key={c.key} className={`flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-[13.5px] ${c.locked ? "text-dim" : "cursor-pointer hover:bg-sunk"}`}>
          <input type="checkbox" checked={cols.shows(c.key)} disabled={c.locked} onChange={() => cols.toggle(c.key)}
            className="h-4 w-4 accent-[var(--color-act)]" />
          {c.label}
        </label>
      ))}
      {cols.hiddenCount > 0 && (
        <div className="mt-1 border-t border-rule-soft px-1 pt-1.5">
          <button type="button" className="text-[12.5px] text-act hover:underline" onClick={cols.reset}>Hiện tất cả cột</button>
        </div>
      )}
    </Pop>
  );
}

/** Dynamic filters: the conditions the person added, then "+ Lọc" to pick another column, then "Xoá lọc". */
export function ColumnFilters({ filter }: { filter: FilterState }) {
  const [last, setLast] = useState<string | null>(null);       // the chip just added opens its editor at once
  const [find, setFind] = useState("");
  const free = filter.defs.filter((d) => !filter.active.includes(d.key) && (d.kind === "number" || d.options.length || d.extra));
  const byKey = new Map(filter.defs.map((d) => [d.key, d]));
  return (
    <>
      {filter.active.map((k) => byKey.get(k) && (
        <CondChip key={k} def={byKey.get(k)!} cond={filter.conds[k]} fresh={k === last}
          set={(c) => filter.set(k, c)} remove={() => filter.remove(k)} />
      ))}
      {free.length > 0 && (
        <Pop button={(open, toggle) => (
          <button type="button" onClick={toggle} aria-expanded={open} className={`${PILL} ${PILL_OFF} border-dashed`}>
            <svg width="13" height="13" viewBox="0 0 13 13" aria-hidden className="opacity-70"><path d="M1.5 2.5h10L7.6 7v3.5l-2.2 1V7z" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" /></svg>
            {filter.active.length ? "Thêm lọc" : "Lọc"}
          </button>
        )}>
          {(close) => (
            <>
              <p className="px-2 pt-1 pb-1.5 text-[11.5px] font-medium tracking-wide text-dim uppercase">Lọc theo</p>
              {free.length > 6 && (
                <input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Tìm cột…" className="field mb-1 h-8 text-[13px]" autoFocus />
              )}
              {free.filter((d) => matches(d.label, find)).map((d) => (
                <button key={d.key} type="button" className="flex w-full items-center rounded-lg px-2 py-1.5 text-left text-[13.5px] hover:bg-sunk"
                  onClick={() => { filter.add(d.key); setLast(d.key); setFind(""); close(); }}>
                  {d.label}
                  <span className="ml-auto text-[12px] text-dim">{d.kind === "number" ? "khoảng" : `${d.options.length} giá trị`}</span>
                </button>
              ))}
            </>
          )}
        </Pop>
      )}
      {filter.active.length > 0 && (
        <button type="button" className="px-1 text-[13px] text-dim hover:text-ink-2 hover:underline" onClick={filter.clear}>Xoá lọc</button>
      )}
    </>
  );
}

/** Search box + page-specific filters (children) + result count, in one wrapping row. */
export function TableTools({ q, setQ, placeholder = "Tìm kiếm…", total, children }: {
  q: string; setQ: (v: string) => void; placeholder?: string; total: number; children?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <div className="relative min-w-0 flex-1 basis-60 sm:max-w-xs">
        <svg width="15" height="15" viewBox="0 0 15 15" aria-hidden className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-dim">
          <circle cx="6.5" cy="6.5" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.4" /><path d="m10 10 3.5 3.5" stroke="currentColor" strokeWidth="1.4" />
        </svg>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} aria-label="Tìm kiếm"
          className="field h-9 rounded-full pr-9 pl-9 text-[13.5px] [&::-webkit-search-cancel-button]:hidden" />
        {q && (
          <button type="button" aria-label="Xoá tìm kiếm" onClick={() => setQ("")}
            className="absolute top-1/2 right-1 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full text-dim hover:bg-sunk hover:text-ink-2">✕</button>
        )}
      </div>
      {children}
      <span role="status" className="tnum ml-auto text-[13px] text-dim">{total.toLocaleString("vi-VN")} kết quả</span>
    </div>
  );
}

/** The pages to offer: all when few, else the first, the last and those around the current one, with gaps. */
export function pageList(page: number, pages: number): (number | "…")[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  const keep = [...new Set([1, pages, page - 1, page, page + 1].filter((n) => n >= 1 && n <= pages))].sort((a, b) => a - b);
  return keep.flatMap((n, i) => (i && n - keep[i - 1] > 1 ? ["…" as const, n] : [n]));
}

const SIZES = [10, 20, 50, 100];

/** Always there under a table: "1–20 / 57 dòng", rows per page, and the pages. */
export function Pager({ t }: { t: { page: number; pages: number; setPage: (p: number) => void; total: number;
  pageSize: number; setPageSize: (n: number) => void } }) {
  const from = t.total ? (t.page - 1) * t.pageSize + 1 : 0;
  const to = Math.min(t.total, t.page * t.pageSize);
  const nav = "grid h-8 min-w-8 place-items-center rounded-full px-2 text-[13px] tnum transition-colors";
  return (
    <nav aria-label="Phân trang" className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-rule-soft px-5 py-2.5 text-[13px] text-dim">
      <span className="tnum">{from}–{to} / {t.total.toLocaleString("vi-VN")} dòng</span>
      <label className="flex items-center gap-1.5">Mỗi trang
        <select value={t.pageSize} onChange={(e) => t.setPageSize(Number(e.target.value))} aria-label="Số dòng mỗi trang"
          className="h-8 rounded-full border border-rule bg-panel px-2 text-[13px] text-ink-2">
          {SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </label>
      <span className="ml-auto flex items-center gap-1">
        <button type="button" className={`${nav} hover:bg-sunk disabled:opacity-40`} disabled={t.page <= 1}
          onClick={() => t.setPage(t.page - 1)} aria-label="Trang trước">‹</button>
        {pageList(t.page, t.pages).map((n, i) => n === "…"
          ? <span key={`gap${i}`} className="px-1">…</span>
          : <button key={n} type="button" aria-current={n === t.page ? "page" : undefined} onClick={() => t.setPage(n)}
              className={`${nav} ${n === t.page ? "bg-act font-semibold text-on-act" : "text-ink-2 hover:bg-sunk"}`}>{n}</button>)}
        <button type="button" className={`${nav} hover:bg-sunk disabled:opacity-40`} disabled={t.page >= t.pages}
          onClick={() => t.setPage(t.page + 1)} aria-label="Trang sau">›</button>
      </span>
    </nav>
  );
}

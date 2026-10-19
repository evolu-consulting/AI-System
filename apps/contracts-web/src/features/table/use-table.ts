// PK-FR-10 · TF6 · useTable: tìm (bỏ dấu) + lọc cột + phân trang. Hai chế độ: client (lọc/cắt mảng, như mgmt-app) và
// server (HD1 D-03: `rows` là TRANG hiện tại, `serverTotal` từ `total` của API; hook chỉ giữ q/page/pageSize/conds để dựng truy vấn).
// Nguồn: reference/mgmt-app-contracts/web/src/components/table.tsx:98-178 (bỏ phần "lọc giúp" của trợ lý — thuộc lát trợ lý).
import { useMemo, useState } from "react";
import {
  applyFilters,
  type ColumnFilter,
  type Cond,
  type FilterState,
  matches,
  normalize,
  optionsOf,
  paginate,
} from "./lib";

export type UseTableOptions<T> = {
  /** Chữ của dòng để tìm kiếm (chế độ client). */
  text: (r: T) => string;
  pageSize?: number;
  filters?: ColumnFilter<T>[];
  /** Có giá trị ⇒ chế độ server: `rows` là trang hiện tại, `serverTotal` là tổng số dòng khớp. */
  serverTotal?: number;
};

export function useTable<T>(rows: T[] | undefined, opts: UseTableOptions<T>) {
  const { text, pageSize = 20, filters = [], serverTotal } = opts;
  const server = serverTotal !== undefined;
  const [q, setQState] = useState("");
  const [page, setPage] = useState(1);
  const [conds, setConds] = useState<Record<string, Cond>>({});
  const [active, setActive] = useState<string[]>([]);
  const [size, setSizeState] = useState(pageSize);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `text`/`filters` thường là literal mới mỗi lần render; chỉ dữ liệu và điều kiện đổi mới tính lại
  const filtered = useMemo(() => {
    if (server) return rows ?? [];
    const kept = applyFilters(rows ?? [], filters, conds);
    return normalize(q).trim() ? kept.filter((r) => matches(text(r), q)) : kept;
  }, [rows, q, conds, server]);

  const total = server ? (serverTotal as number) : filtered.length;
  const p = server
    ? {
        pages: Math.max(1, Math.ceil(total / size)),
        page: Math.min(Math.max(1, page), Math.max(1, Math.ceil(total / size))),
        shown: filtered,
      }
    : paginate(filtered, page, size);

  const setQ = (v: string) => {
    setQState(v);
    setPage(1);
  };
  const setPageSize = (n: number) => {
    setSizeState(n);
    setPage(1);
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: như trên
  const defs = useMemo(
    () =>
      filters.map((f) => ({
        key: f.key,
        label: f.label,
        kind: f.kind ?? ("values" as const),
        options: f.kind === "number" ? [] : optionsOf(rows ?? [], f.value),
      })),
    [rows],
  );
  const filter: FilterState = {
    defs,
    active,
    conds,
    add: (key) => setActive((a) => (a.includes(key) ? a : [...a, key])),
    set: (key, c) => {
      setConds((was) => ({ ...was, [key]: c }));
      setPage(1);
    },
    remove: (key) => {
      setActive((a) => a.filter((k) => k !== key));
      setConds((was) => {
        const { [key]: _, ...rest } = was;
        return rest;
      });
      setPage(1);
    },
    clear: () => {
      setActive([]);
      setConds({});
      setPage(1);
    },
  };

  return {
    q,
    setQ,
    page: p.page,
    setPage,
    pages: p.pages,
    total,
    shown: p.shown,
    filter,
    pageSize: size,
    setPageSize,
  };
}

export type TableState = ReturnType<typeof useTable>;

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

/** Lọc theo cột: điều kiện + cột đang bật + định nghĩa cột (tuỳ chọn suy từ dữ liệu). `onChange` = về trang 1. */
function useColumnFilter<T>(
  rows: T[] | undefined,
  filters: ColumnFilter<T>[],
  onChange: () => void,
) {
  const [conds, setConds] = useState<Record<string, Cond>>({});
  const [active, setActive] = useState<string[]>([]);
  const optionsKey = filters.map((f) => f.options?.join("\u0001") ?? "").join("\u0002");
  // biome-ignore lint/correctness/useExhaustiveDependencies: `filters` thường là literal mới mỗi lần render; chỉ dữ liệu/lựa chọn đổi mới tính lại
  const defs = useMemo(
    () =>
      filters.map((f) => ({
        key: f.key,
        label: f.label,
        kind: f.kind ?? ("values" as const),
        options: f.kind === "number" ? [] : (f.options ?? optionsOf(rows ?? [], f.value)),
        extra: f.extra,
      })),
    [rows, optionsKey],
  );
  const filter: FilterState = {
    defs,
    active,
    conds,
    add: (key) => setActive((a) => (a.includes(key) ? a : [...a, key])),
    set: (key, c) => {
      setConds((was) => ({ ...was, [key]: c }));
      onChange();
    },
    remove: (key) => {
      setActive((a) => a.filter((k) => k !== key));
      setConds((was) => {
        const { [key]: _, ...rest } = was;
        return rest;
      });
      onChange();
    },
    clear: () => {
      setActive([]);
      setConds({});
      onChange();
    },
  };
  return { conds, filter };
}

/** Phân trang: server (`rows` đã là trang) hoặc client (cắt mảng). */
function pageOf<T>(
  filtered: T[],
  paging: { server: boolean; total: number; page: number; size: number },
) {
  const { server, total, page, size } = paging;
  if (!server) return paginate(filtered, page, size);
  const pages = Math.max(1, Math.ceil(total / size));
  return { pages, page: Math.min(Math.max(1, page), pages), shown: filtered };
}

export function useTable<T>(rows: T[] | undefined, opts: UseTableOptions<T>) {
  const { text, pageSize = 20, filters = [], serverTotal } = opts;
  const server = serverTotal !== undefined;
  const [q, setQState] = useState("");
  const [page, setPage] = useState(1);
  const [size, setSizeState] = useState(pageSize);
  const { conds, filter } = useColumnFilter(rows, filters, () => setPage(1));

  // biome-ignore lint/correctness/useExhaustiveDependencies: `text`/`filters` thường là literal mới mỗi lần render; chỉ dữ liệu và điều kiện đổi mới tính lại
  const filtered = useMemo(() => {
    if (server) return rows ?? [];
    const kept = applyFilters(rows ?? [], filters, conds);
    return normalize(q).trim() ? kept.filter((r) => matches(text(r), q)) : kept;
  }, [rows, q, conds, server]);

  const total = server ? (serverTotal as number) : filtered.length;
  const p = pageOf(filtered, { server, total, page, size });

  const setQ = (v: string) => {
    setQState(v);
    setPage(1);
  };
  const setPageSize = (n: number) => {
    setSizeState(n);
    setPage(1);
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

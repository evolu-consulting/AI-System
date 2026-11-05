// PK-FR-10 · TF6 · logic thuần của bảng: bỏ dấu tiếng Việt, lọc cột, phân trang. Nguồn: reference/mgmt-app-contracts/web/src/components/table.tsx:3-64, 402-407 (port nguyên logic).

/** Chữ thường, bỏ dấu: "Hà Nội" khớp "ha noi", "Đức" khớp "duc". */
export function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase();
}

/** Mọi từ của `query` phải có trong `haystack`. Query rỗng khớp tất cả. */
export function matches(haystack: string, query: string): boolean {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const h = normalize(haystack);
  return words.every((w) => h.includes(w));
}

/** Số trang (≥ 1) và lát cắt của trang 1-based, kẹp vào khoảng hợp lệ. */
export function paginate<T>(rows: T[], page: number, pageSize: number) {
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const p = Math.min(Math.max(1, page), pages);
  return { pages, page: p, shown: rows.slice((p - 1) * pageSize, p * pageSize) };
}

import type { ReactNode } from "react";

export type Vals = string | string[] | number | null | undefined;
/** Cột cho phép lọc. "values": lựa chọn là các giá trị đang có trong dòng (một dòng có thể giữ nhiều giá trị),
 *  chọn nhiều ⇒ giữ dòng có bất kỳ giá trị nào. "number": khoảng từ–đến. */
export type ColumnFilter<T> = {
  key: string;
  label: string;
  value: (r: T) => Vals;
  kind?: "values" | "number";
  /** Chế độ server: lựa chọn từ facets (cả tenant), không suy từ trang hiện tại. */
  options?: string[];
  /** Nút phụ cuối ô sửa lọc (vd "+ Loại mới"). */
  extra?: ReactNode;
};
/** Một điều kiện người dùng thêm: một trong các giá trị, hoặc một khoảng. */
export type Cond = { in?: string[]; min?: number | null; max?: number | null };
export type FilterDef = {
  key: string;
  label: string;
  kind: "values" | "number";
  options: string[];
  extra?: ReactNode;
};
export type FilterState = {
  defs: FilterDef[];
  /** Điều kiện theo thứ tự thêm (trường vừa thêm chưa chọn gì vẫn hiện). */
  active: string[];
  conds: Record<string, Cond>;
  add: (key: string) => void;
  set: (key: string, c: Cond) => void;
  remove: (key: string) => void;
  clear: () => void;
};

const list = (v: Vals): string[] =>
  (Array.isArray(v) ? v : typeof v === "string" ? [v] : []).filter((x) => x?.trim());

/** Giá trị khác nhau, khác rỗng của một cột, sắp theo tiếng Việt. */
export function optionsOf<T>(rows: T[], value: (r: T) => Vals): string[] {
  return [...new Set(rows.flatMap((r) => list(value(r))))].sort((a, b) => a.localeCompare(b, "vi"));
}

/** Điều kiện có ràng buộc thật (trường vừa thêm chưa chọn gì thì không). */
export const isSet = (c: Cond | undefined): boolean =>
  !!c && (!!c.in?.length || c.min != null || c.max != null);

/** Dòng qua mọi điều kiện đã đặt. */
export function applyFilters<T>(
  rows: T[],
  filters: ColumnFilter<T>[],
  conds: Record<string, Cond>,
): T[] {
  return filters.reduce((acc, f) => {
    const c = conds[f.key];
    if (!c || !isSet(c)) return acc;
    if (f.kind === "number") {
      return acc.filter((r) => {
        const n = f.value(r);
        return (
          typeof n === "number" && (c.min == null || n >= c.min) && (c.max == null || n <= c.max)
        );
      });
    }
    const wanted = c.in ?? [];
    return acc.filter((r) => list(f.value(r)).some((v) => wanted.includes(v)));
  }, rows);
}

/** Các trang đưa ra: đủ hết khi ít, ngược lại trang đầu, cuối và quanh trang hiện tại, có "…". */
export function pageList(page: number, pages: number): (number | "…")[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  const keep = [
    ...new Set([1, pages, page - 1, page, page + 1].filter((n) => n >= 1 && n <= pages)),
  ].sort((a, b) => a - b);
  return keep.flatMap((n, i) => (i && n - (keep[i - 1] as number) > 1 ? ["…" as const, n] : [n]));
}

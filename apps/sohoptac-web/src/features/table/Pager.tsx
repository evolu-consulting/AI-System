// PK-FR-10 · TF6 · phân trang luôn có dưới bảng: "1–20 / 57 dòng", số dòng mỗi trang, các trang. Khớp HD1 D-03 (page, page_size ≤ 100, total).
// Nguồn: table.tsx:402-438.
import { useTranslation } from "react-i18next";
import { cn } from "~/lib/utils";
import { pageList } from "./lib";

/** Mỗi trang tối đa 100 = trần `page_size` của API HD1 (D-03). */
export const PAGE_SIZES = [10, 20, 50, 100] as const;

export type PagerState = {
  page: number;
  pages: number;
  setPage: (p: number) => void;
  total: number;
  pageSize: number;
  setPageSize: (n: number) => void;
};

const NAV =
  "grid h-8 min-w-8 place-items-center rounded-full px-2 text-label tabular-nums transition-colors";

export function Pager({ t: s }: { t: PagerState }) {
  const { t } = useTranslation();
  const from = s.total ? (s.page - 1) * s.pageSize + 1 : 0;
  const to = Math.min(s.total, s.page * s.pageSize);
  return (
    <nav
      aria-label={t("contracts.table.pagination")}
      className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-rule-soft px-5 py-2.5 text-label text-dim"
    >
      <span className="tabular-nums">
        {from}–{to} / {t("contracts.table.rows", { n: s.total.toLocaleString("vi-VN") })}
      </span>
      <label className="flex items-center gap-1.5">
        {t("contracts.table.perPage")}
        <select
          value={s.pageSize}
          onChange={(e) => s.setPageSize(Number(e.target.value))}
          aria-label={t("contracts.table.pageSizeAria")}
          className="h-8 rounded-full border border-rule bg-panel px-2 text-label text-ink-2"
        >
          {PAGE_SIZES.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
      <span className="ml-auto flex items-center gap-1">
        <button
          type="button"
          className={cn(NAV, "hover:bg-sunk disabled:opacity-40")}
          disabled={s.page <= 1}
          onClick={() => s.setPage(s.page - 1)}
          aria-label={t("contracts.table.prev")}
        >
          ‹
        </button>
        {pageList(s.page, s.pages).map((n, i) =>
          n === "…" ? (
            // biome-ignore lint/suspicious/noArrayIndexKey: dấu "…" không có định danh; vị trí là khoá duy nhất
            <span key={`gap${i}`} className="px-1">
              …
            </span>
          ) : (
            <button
              key={n}
              type="button"
              aria-current={n === s.page ? "page" : undefined}
              onClick={() => s.setPage(n)}
              className={cn(
                NAV,
                n === s.page ? "bg-act font-semibold text-on-act" : "text-ink-2 hover:bg-sunk",
              )}
            >
              {n}
            </button>
          ),
        )}
        <button
          type="button"
          className={cn(NAV, "hover:bg-sunk disabled:opacity-40")}
          disabled={s.page >= s.pages}
          onClick={() => s.setPage(s.page + 1)}
          aria-label={t("contracts.table.next")}
        >
          ›
        </button>
      </span>
    </nav>
  );
}

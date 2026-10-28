// Lọc bảng tin (logic thuần): dùng cho adapter mock và chip đếm; server C3 làm cùng quy tắc.
import type { FeedCounts, FeedQuery, FeedTab, PostView } from "@ai/contracts/community";

/** Bỏ dấu + chữ thường để tìm "chữ thường" tiếng Việt. */
export const fold = (s: string): string =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").toLowerCase();

const inTab = (p: PostView, tab: FeedTab): boolean => {
  if (tab === "archived") return p.status !== "active";
  if (p.status !== "active") return false;
  return tab === "all" || p.type === tab;
};

function matchesFilters(p: PostView, q: FeedQuery): boolean {
  if (q.cat && !p.cats.includes(q.cat)) return false;
  if (q.area && (p.fields.area ?? "") !== q.area) return false;
  if (q.authorOrgId && p.authorOrgId !== q.authorOrgId) return false;
  const term = q.q ? fold(q.q) : "";
  if (!term) return true;
  const hay = fold([p.title, p.body, p.fields.product ?? "", p.authorOrgName].join(" "));
  return hay.includes(term);
}

export function applyFeedQuery(all: PostView[], q: FeedQuery): PostView[] {
  const tab = q.tab ?? "all";
  return all.filter((p) => matchesFilters(p, q) && inTab(p, tab));
}

export function countTabs(all: PostView[], q: FeedQuery): FeedCounts {
  const base = all.filter((p) => matchesFilters(p, q));
  const n = (tab: FeedTab) => base.filter((p) => inTab(p, tab)).length;
  return {
    all: n("all"),
    sell: n("sell"),
    buy: n("buy"),
    note: n("note"),
    archived: n("archived"),
  };
}

export const uniqueSorted = (xs: string[]): string[] =>
  [...new Set(xs.filter(Boolean))].sort((a, b) => a.localeCompare(b, "vi"));

/** Có bộ lọc nào ngoài tab đang bật? (hiện nút "Xoá lọc") */
export const hasActiveFilter = (q: FeedQuery): boolean =>
  Boolean(q.cat || q.area || q.authorOrgId || q.q);

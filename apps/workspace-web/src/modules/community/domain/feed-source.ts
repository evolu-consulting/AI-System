// CR-191 · logic thuần của bộ lọc bảng tin gộp: nguồn bài (Tất cả / Công ty mình / Đối tác / một công ty đã kết nối), đếm, nhãn.
import type { FeedCounts, FeedQuery, FeedTab, PostView } from "@ai/contracts/community";

/** "" = tất cả; "own" = Công ty mình; "connected" = mọi Đối tác; còn lại = id một công ty đã kết nối. */
export type SourcePick = string;

/** Nguồn đã chọn ⇒ phần query gửi máy chủ. */
export function sourceQuery(pick: SourcePick): Pick<FeedQuery, "source" | "authorOrgId"> {
  if (pick === "") return {};
  if (pick === "own" || pick === "connected") return { source: pick };
  return { authorOrgId: pick };
}

/** Số bài cạnh một nguồn: máy chủ chỉ đếm bài công ty mình ⇒ chỉ «Công ty mình» có số; các nguồn khác ẩn số (null). */
export function sourceCount(
  counts: FeedCounts | undefined,
  tab: FeedTab,
  pick: string,
): number | null {
  return pick === "own" && counts ? (counts[tab] ?? 0) : null;
}

/** Số cạnh một loại bài: đúng khi danh sách chỉ gồm bài công ty mình (nguồn «Công ty mình»); ngược lại ẩn số. */
export function typeCount(
  counts: FeedCounts | undefined,
  tab: FeedTab,
  pick: SourcePick,
): number | null {
  return pick === "own" && counts ? (counts[tab] ?? 0) : null;
}

/** Số bộ lọc đang bật (hiện trên nút «Lọc»). Loại «Tất cả» và nguồn «Tất cả» không tính. */
export const activeFilterCount = (f: {
  tab: FeedTab;
  cat: string;
  area: string;
  source: SourcePick;
}): number => Number(f.tab !== "all") + Number(!!f.cat) + Number(!!f.area) + Number(!!f.source);

export const isPartnerPost = (p: Pick<PostView, "source">): boolean => p.source === "connected";

/** Khoá nhãn nguồn của bài: «Công ty mình» hoặc «Đối tác». */
export const sourceKey = (p: Pick<PostView, "source">): "own" | "connected" =>
  isPartnerPost(p) ? "connected" : "own";

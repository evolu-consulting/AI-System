// CR-147c · logic thuần của bảng tin tải dần: khoá phạm vi (người xem + bộ lọc) và cách thay/gộp trang đầu.
import type { CommunityViewer, FeedQuery, FeedResponse } from "@ai/contracts/community";

/** Khoá phạm vi dữ liệu: đổi người xem (người/vai/công ty) hoặc bộ lọc ⇒ danh sách cũ KHÔNG còn đúng và phải bỏ. */
export function feedScopeKey(
  query: FeedQuery,
  viewer: Pick<CommunityViewer, "userId" | "orgId" | "role">,
): string {
  return JSON.stringify([viewer.userId, viewer.orgId, viewer.role, query]);
}

/** Gộp trang đầu mới nạp (sau khi dữ liệu đổi) vào danh sách đã tải dần: bài trong cửa sổ trang đầu lấy bản mới, bài đã tải ở trang sau giữ nguyên. */
export function mergeFirstPage(old: FeedResponse, fresh: FeedResponse): FeedResponse {
  const ids = new Set(fresh.items.map((p) => p.id));
  const tail = old.items.slice(fresh.items.length).filter((p) => !ids.has(p.id));
  const next = tail.length > 0 ? old.nextCursor : fresh.nextCursor;
  const { nextCursor: _drop, ...rest } = fresh;
  return { ...rest, items: [...fresh.items, ...tail], ...(next ? { nextCursor: next } : {}) };
}

/** Trang đầu về ⇒ cùng phạm vi: gộp (giữ phần đã tải dần); khác phạm vi: thay hẳn (không giữ bài cũ có thể không còn được xem). */
export function applyFirstPage(
  old: FeedResponse | null,
  fresh: FeedResponse,
  sameScope: boolean,
): FeedResponse {
  return old && sameScope ? mergeFirstPage(old, fresh) : fresh;
}

/** Bài vừa xoá (lạc quan) ⇒ bỏ khỏi danh sách ngay, kể cả bài ở trang sau đã tải dần mà lần nạp lại trang đầu không đụng tới. */
export function withoutGone(
  data: FeedResponse | null,
  gone: ReadonlySet<string>,
): FeedResponse | null {
  if (!data || gone.size === 0 || !data.items.some((p) => gone.has(p.id))) return data;
  return { ...data, items: data.items.filter((p) => !gone.has(p.id)) };
}

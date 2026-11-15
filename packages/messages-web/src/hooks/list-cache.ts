// CR-169 · lát 6 · danh sách có nhiều bản theo bộ lọc công ty (`msgKeys.listBy`): sự kiện realtime / gửi / đọc áp vào MỌI bản đang có trong cache.
import type { QueryClient } from "@tanstack/react-query";
import { msgKeys } from "../api";
import type { ListPages } from "../lib/conversations";

/** Áp `fn` vào mọi bản danh sách đang có trong cache. */
export function patchLists(qc: QueryClient, fn: (l: ListPages) => ListPages): void {
  qc.setQueriesData<ListPages>({ queryKey: msgKeys.list }, (l) => (l ? fn(l) : l));
}

/** Các bản danh sách đang có trong cache (chưa tải ⇒ bỏ qua). */
export function cachedLists(qc: QueryClient): ListPages[] {
  return qc
    .getQueriesData<ListPages>({ queryKey: msgKeys.list })
    .flatMap(([, d]) => (d ? [d] : []));
}

/** Gộp thành một danh sách phẳng để tra (tên người gửi, số chưa đọc) — không dùng để vẽ. */
export function mergedList(qc: QueryClient): ListPages {
  return {
    pages: [
      { items: cachedLists(qc).flatMap((l) => l.pages.flatMap((p) => p.items)), next_cursor: null },
    ],
  };
}

// CR-169 · lát 6 · danh sách có nhiều bản theo bộ lọc công ty (`msgKeys.listBy`): sự kiện realtime / gửi / đọc áp vào MỌI bản đang có trong cache.
import type { QueryClient } from "@tanstack/react-query";
import { msgKeys } from "../api";
import type { ListPages } from "../lib/conversations";
import { type DirData, dirConversations } from "../lib/directory";

/** Áp `fn` vào mọi bản danh sách đang có trong cache. */
export function patchLists(qc: QueryClient, fn: (l: ListPages) => ListPages): void {
  qc.setQueriesData<ListPages>({ queryKey: msgKeys.list }, (l) => (l ? fn(l) : l));
}

/** CR-190 · áp `fn` vào mọi bản danh bạ nhóm đang có trong cache (mỗi ô tìm một bản). */
export function patchDirs(qc: QueryClient, fn: (d: DirData) => DirData): void {
  qc.setQueriesData<DirData>({ queryKey: msgKeys.dirAll }, (d) => (d ? fn(d) : d));
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
      {
        items: [
          ...cachedLists(qc).flatMap((l) => l.pages.flatMap((p) => p.items)),
          ...qc
            .getQueriesData<DirData>({ queryKey: msgKeys.dirAll })
            .flatMap(([, d]) => dirConversations(d)),
        ],
        next_cursor: null,
      },
    ],
  };
}

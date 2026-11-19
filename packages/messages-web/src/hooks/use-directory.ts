// CR-190 · danh bạ nhóm của trang Tin nhắn: MỘT query `GET /messages/directory` (15 dòng đầu mỗi nhóm), «Xem thêm» nối trang của riêng nhóm vào cùng cache,
// ghim / đánh dấu / đọc áp ngay vào cache rồi báo máy chủ (lỗi ⇒ tải lại cho đúng). Realtime áp vào cùng cache (`msg-realtime`).
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchDirectory,
  fetchDirectoryMore,
  markRead,
  msgKeys,
  setMarkedUnread,
  setPinned,
} from "../api";
import { appendPage, applyPrefsToDir, clearUnreadInDir, type DirData } from "../lib/directory";
import { patchDirs } from "./list-cache";
import { useMsgRealtime } from "./use-unread";

export function useDirectory(q: string) {
  useMsgRealtime();
  return useQuery({
    queryKey: msgKeys.dir(q),
    queryFn: ({ signal }) => fetchDirectory(q, signal),
    staleTime: 30_000,
    retry: false,
    // Đổi chữ tìm: giữ danh bạ cũ trên màn hình tới khi bản mới về (không nháy trống).
    placeholderData: keepPreviousData,
  });
}

/** «Xem thêm (n)» của một nhóm: tải trang kế rồi nối vào cuối nhóm đó (chỉ nhóm đó đổi). */
export function useLoadMoreGroup(q: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ group, cursor }: { group: string; cursor: string }) =>
      fetchDirectoryMore(group, cursor, q),
    onSuccess: (page, v) => {
      if (!page) return;
      qc.setQueryData<DirData>(msgKeys.dir(q), (d) => (d ? appendPage(d, v.group, page) : d));
    },
  });
}

/** Ghim / bỏ ghim / đánh dấu chưa đọc / đã đọc một cuộc đã có. */
export function useRowActions() {
  const qc = useQueryClient();
  const settle = () => {
    void qc.invalidateQueries({ queryKey: msgKeys.dirAll });
    void qc.invalidateQueries({ queryKey: msgKeys.list });
    void qc.invalidateQueries({ queryKey: msgKeys.unread });
  };
  const prefs = useMutation({
    mutationFn: (v: { id: string; pinned?: boolean; unread?: boolean }) =>
      v.pinned !== undefined ? setPinned(v.id, v.pinned) : setMarkedUnread(v.id, v.unread ?? false),
    onSuccess: (p, v) => patchDirs(qc, (d) => applyPrefsToDir(d, v.id, p)),
    onSettled: settle,
  });
  const read = useMutation({
    mutationFn: async (v: { id: string; seq: number | null; flagged: boolean }) => {
      if (v.seq) await markRead(v.id, v.seq);
      else if (v.flagged) await setMarkedUnread(v.id, false);
    },
    onMutate: (v) => patchDirs(qc, (d) => clearUnreadInDir(d, v.id)),
    onSettled: settle,
  });
  return {
    pin: (id: string, pinned: boolean) => prefs.mutate({ id, pinned }),
    markUnread: (id: string) => prefs.mutate({ id, unread: true }),
    markRead: (id: string, seq: number | null, flagged: boolean) =>
      read.mutate({ id, seq, flagged }),
  };
}

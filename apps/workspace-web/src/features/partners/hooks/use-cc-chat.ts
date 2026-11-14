// CR-161 · lát 8 · truy vấn/ghi trò chuyện hai công ty: tải dần tin cũ (cursor `before`), gửi (client_id ⇒ gửi lặp không nhân đôi),
// tin mới qua `/me/stream` (`cc.msg`), đánh dấu đã đọc, tệp soạn dở (tải lên ngay khi chọn), bài Bảng tin công khai.
import type { CcFile } from "@ai/contracts/pack-contracts";
import type { DraftItem } from "@ai/web-kit/ui/AttachDraft";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { meStream } from "~/platform/stream/me-stream";
import {
  connectKeys,
  fetchPosts,
  fetchThread,
  fetchThreadFileUrl,
  markThreadRead,
  sendThreadMessage,
  uploadThreadFile,
} from "../api.connect";
import {
  type ChatErr,
  chatErrKey,
  fileProblem,
  flattenPages,
  parseCcMsgFrame,
  readTarget,
} from "../lib/cc-chat";
import { errCodeOf } from "./use-connect";

const statusOf = (e: unknown): number | undefined =>
  e && typeof e === "object" && "status" in e ? (e as { status: number }).status : undefined;
export const errOf = (e: unknown): ChatErr => chatErrKey(errCodeOf(e), statusOf(e));

export function useThread(other: string) {
  const q = useInfiniteQuery({
    queryKey: connectKeys.thread(other),
    queryFn: ({ pageParam, signal }) => fetchThread(other, pageParam, signal),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (last) => last.next_before ?? undefined,
    retry: false,
  });
  const pages = q.data?.pages;
  const messages = useMemo(() => flattenPages(pages ?? []), [pages]);
  const first = pages?.[0];
  return {
    q,
    messages,
    /** Trang mới nhất quyết định chỉ-đọc / mốc đã đọc. */
    readOnly: first?.read_only ?? false,
    lastRead: first?.last_read_seq ?? 0,
    noThread: q.error ? errCodeOf(q.error) === "CONNECT_NO_THREAD" : false,
  };
}

/** Tin mới của công ty kia ⇒ tải lại luồng (+ số chưa đọc). Nối lại sau đứt ⇒ tải lại một lần. */
export function useCcStream(other: string) {
  const qc = useQueryClient();
  useEffect(() => {
    const refresh = () => {
      void qc.invalidateQueries({ queryKey: connectKeys.thread(other) });
      void qc.invalidateQueries({ queryKey: connectKeys.all });
    };
    return meStream.subscribe(
      "cc.msg",
      (f) => {
        const d = parseCcMsgFrame(f.data);
        if (d && d.tenant_id === other) refresh();
      },
      refresh,
    );
  }, [other, qc]);
}

/** Gửi một tin. `clientId` do người gọi giữ: thử lại cùng id ⇒ máy chủ trả lại tin cũ (`created:false`), không nhân đôi. */
export function useSendMessage(other: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { clientId: string; body: string; fileIds: string[] }) =>
      sendThreadMessage(other, { client_id: v.clientId, body: v.body, file_ids: v.fileIds }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: connectKeys.thread(other) });
    },
  });
}

/** Đang mở luồng + tin mới hơn mốc đã đọc ⇒ báo đã đọc một lần cho mỗi mốc. */
export function useMarkRead(
  other: string,
  messages: Parameters<typeof readTarget>[0],
  lastRead: number,
  active: boolean,
) {
  const qc = useQueryClient();
  const sent = useRef({ other, seq: 0 });
  if (sent.current.other !== other) sent.current = { other, seq: 0 };
  const mark = useMutation({
    mutationFn: (seq: number) => markThreadRead(other, seq),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: connectKeys.thread(other) });
      void qc.invalidateQueries({ queryKey: connectKeys.links("connected") });
    },
  });
  const target = active ? readTarget(messages, lastRead, sent.current.seq) : null;
  useEffect(() => {
    if (target === null) return;
    sent.current.seq = target;
    mark.mutate(target);
  }, [target, mark.mutate]);
}

export type DraftEntry = DraftItem & { server?: CcFile };

/** Tệp soạn dở: chọn xong tải lên ngay; ✕ bỏ; lỗi giữ lại kèm câu giải thích + «Thử lại». */
export function useDraftFiles(other: string, onProblem: (e: ChatErr, name: string) => string) {
  const [items, setItems] = useState<DraftEntry[]>([]);
  const files = useRef(new Map<string, File>());
  const patch = useCallback(
    (id: string, p: Partial<DraftEntry>) =>
      setItems((s) => s.map((x) => (x.id === id ? { ...x, ...p } : x))),
    [],
  );
  const upload = useCallback(
    (id: string, file: File) => {
      patch(id, { status: "uploading", errorText: undefined, retryable: false });
      uploadThreadFile(other, file).then(
        (server) => patch(id, { status: "ready", server, size: server.size }),
        (e) => {
          const k = errOf(e);
          patch(id, {
            status: "error",
            errorText: onProblem(k, file.name),
            retryable: k === "failed" || k === "storage",
          });
        },
      );
    },
    [other, onProblem, patch],
  );
  const add = useCallback(
    (list: readonly File[]) => {
      for (const f of list) {
        const id = crypto.randomUUID();
        files.current.set(id, f);
        const base = { id, name: f.name, mime: f.type || "application/octet-stream", size: f.size };
        const bad = fileProblem(f);
        if (bad) {
          setItems((s) => [
            ...s,
            { ...base, status: "error", errorText: onProblem(bad, f.name), file: f },
          ]);
        } else {
          setItems((s) => [...s, { ...base, status: "uploading", file: f }]);
          upload(id, f);
        }
      }
    },
    [upload, onProblem],
  );
  const remove = useCallback((id: string) => {
    files.current.delete(id);
    setItems((s) => s.filter((x) => x.id !== id));
  }, []);
  const retry = useCallback(
    (id: string) => {
      const f = files.current.get(id);
      if (f) upload(id, f);
    },
    [upload],
  );
  const clear = useCallback(() => {
    files.current.clear();
    setItems([]);
  }, []);
  return {
    items,
    add,
    remove,
    retry,
    clear,
    readyIds: items.filter((x) => x.status === "ready" && x.server).map((x) => x.server?.id ?? ""),
    uploading: items.filter((x) => x.status === "uploading").length,
    failed: items.filter((x) => x.status === "error").length,
  };
}

export const ccFileUrl = (id: string): Promise<string> => fetchThreadFileUrl(id);

export function usePosts(other: string, enabled: boolean) {
  const q = useInfiniteQuery({
    queryKey: connectKeys.posts(other),
    queryFn: ({ pageParam, signal }) => fetchPosts(other, pageParam, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor,
    enabled,
    retry: false,
  });
  const posts = useMemo(() => q.data?.pages.flatMap((p) => p.items) ?? [], [q.data]);
  return { q, posts };
}

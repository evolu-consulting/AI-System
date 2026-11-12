// CR-132 · W2 · khung chat của MỘT hội thoại: chi tiết, trang tin (tải thêm cũ), gửi (tin đang gửi mờ, lỗi bấm gửi lại), thu hồi,
// đánh dấu đã đọc khi mở/tin tới, đổi tên / thêm / bớt / rời nhóm.
import type { ConversationDetail, FileRef, Message } from "@ai/contracts/pack-contracts";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  addMembers,
  fetchConversation,
  fetchMessages,
  markRead,
  msgKeys,
  removeMember,
  renameConversation,
  revokeMessage,
  sendMessage,
} from "../api";
import { applyNewToList, clearUnread, type ListPages } from "../lib/conversations";
import { errorKey } from "../lib/errors";
import {
  applyDeleted,
  applyNewMessage,
  flattenPages,
  type MsgPages,
  nextBefore,
} from "../lib/message-pages";
import { setViewing } from "./msg-realtime";
import { useMsgRealtime } from "./use-unread";

export function useConversation(id: string) {
  return useQuery({
    queryKey: msgKeys.detail(id),
    queryFn: ({ signal }) => fetchConversation(id, signal),
    staleTime: 30_000,
    retry: false,
  });
}

export function useMessages(id: string) {
  const q = useInfiniteQuery({
    queryKey: msgKeys.msgs(id),
    queryFn: ({ pageParam, signal }) => fetchMessages(id, pageParam, signal),
    initialPageParam: null as number | null,
    getNextPageParam: (last) => nextBefore([last]),
    staleTime: 30_000,
    retry: false,
  });
  const items = useMemo(() => flattenPages(q.data as MsgPages | undefined), [q.data]);
  return { ...q, items };
}

export type Outgoing = {
  clientId: string;
  body: string;
  fileIds: string[];
  fileNames: string[];
  failed: string | null;
};

/** Tin đang gửi (mờ; component phải `key={id}` để đổi hội thoại thì hàng chờ trống) / gửi lỗi (bấm gửi lại cùng `client_id` ⇒ server không tạo trùng). */
export function useOutbox(id: string, myId: string) {
  const qc = useQueryClient();
  const [out, setOut] = useState<Outgoing[]>([]);
  const run = useCallback(
    (clientId: string, body: string, fileIds: string[], fileNames: string[]) => {
      setOut((o) =>
        o.some((x) => x.clientId === clientId)
          ? o.map((x) => (x.clientId === clientId ? { ...x, failed: null } : x))
          : [...o, { clientId, body, fileIds, fileNames, failed: null }],
      );
      sendMessage(id, { client_id: clientId, body, file_ids: fileIds })
        .then((m: Message) => {
          qc.setQueryData<MsgPages>(msgKeys.msgs(id), (old) => applyNewMessage(old, m));
          const list = qc.getQueryData<ListPages>(msgKeys.list);
          const r = list && applyNewToList(list, m, { myId, viewing: true, senderName: "" });
          if (r?.known) qc.setQueryData(msgKeys.list, r.data);
          else void qc.invalidateQueries({ queryKey: msgKeys.list });
          setOut((o) => o.filter((x) => x.clientId !== clientId));
        })
        .catch((e: unknown) =>
          setOut((o) =>
            o.map((x) => (x.clientId === clientId ? { ...x, failed: errorKey(e) } : x)),
          ),
        );
    },
    [id, qc, myId],
  );
  const send = useCallback(
    (body: string, files: readonly FileRef[] = []) =>
      run(
        crypto.randomUUID(),
        body,
        files.map((f) => f.id),
        files.map((f) => f.name),
      ),
    [run],
  );
  const retry = useCallback(
    (clientId: string) => {
      const x = out.find((o) => o.clientId === clientId);
      if (x) run(clientId, x.body, x.fileIds, x.fileNames);
    },
    [out, run],
  );
  return { outgoing: out, send, retry };
}

export function useRevoke(id: string) {
  const qc = useQueryClient();
  return useMutation<void, Error, number>({
    mutationFn: (seq) => revokeMessage(id, seq),
    onSuccess: (_v, seq) => {
      qc.setQueryData<MsgPages>(msgKeys.msgs(id), (o) => applyDeleted(o, seq));
      void qc.invalidateQueries({ queryKey: msgKeys.list });
    },
  });
}

/** Mở hội thoại (tab đang hiển thị) hoặc tin tới khi đang mở ⇒ báo đã đọc tới tin cuối. Đăng ký «đang xem» để tin tới không cộng chưa đọc. */
export function useMarkRead(id: string, lastSeq: number | null, myId: string) {
  const qc = useQueryClient();
  useMsgRealtime();
  const sent = useRef(0);
  useEffect(() => {
    sent.current = 0;
    setViewing(id);
    return () => setViewing(null);
  }, [id]);
  useEffect(() => {
    if (!lastSeq || lastSeq <= sent.current) return;
    const go = () => {
      if (document.visibilityState !== "visible" || lastSeq <= sent.current) return;
      sent.current = lastSeq;
      markRead(id, lastSeq)
        .then((r) => {
          qc.setQueryData<ListPages>(msgKeys.list, (l) => (l ? clearUnread(l, id) : l));
          qc.setQueryData(msgKeys.unread, { total: r.unread_total });
          qc.setQueryData<ConversationDetail>(msgKeys.detail(id), (c) =>
            c
              ? {
                  ...c,
                  members: c.members.map((m) =>
                    m.user_id === myId && lastSeq > m.last_read_seq
                      ? { ...m, last_read_seq: lastSeq }
                      : m,
                  ),
                }
              : c,
          );
        })
        .catch(() => {
          sent.current = 0; // thử lại ở lần tin tới kế
        });
    };
    go();
    document.addEventListener("visibilitychange", go);
    return () => document.removeEventListener("visibilitychange", go);
  }, [id, lastSeq, myId, qc]);
}

function useGroupMutation<V>(id: string, fn: (v: V) => Promise<ConversationDetail | undefined>) {
  const qc = useQueryClient();
  return useMutation<ConversationDetail | undefined, Error, V>({
    mutationFn: fn,
    onSuccess: (d) => {
      if (d) qc.setQueryData(msgKeys.detail(id), d);
      void qc.invalidateQueries({ queryKey: msgKeys.list });
      void qc.invalidateQueries({ queryKey: msgKeys.detail(id) });
    },
  });
}

export function useGroupActions(id: string) {
  return {
    rename: useGroupMutation<string>(id, (title) => renameConversation(id, title)),
    add: useGroupMutation<string[]>(id, (ids) => addMembers(id, { user_ids: ids })),
    remove: useGroupMutation<string>(id, (uid) => removeMember(id, uid).then(() => undefined)),
  };
}

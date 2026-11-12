// CR-132 · W2 · nghe `msg.*` trên `/me/stream` (MỘT bộ cho cả tab, đếm số bên dùng) và áp vào cache react-query bằng luật thuần.
// Nạp lazy (kéo zod) — vỏ ứng dụng chỉ `import()` khi mục «Tin nhắn» hiện. Sự kiện lạ/hỏng ⇒ bỏ qua. Nối lại sau đứt ⇒ tải lại tất cả.

import type { ConversationDetail } from "@ai/contracts/pack-contracts";
import {
  MsgConversationEventDataSchema,
  MsgDeletedEventDataSchema,
  MsgNewEventDataSchema,
  MsgReadEventDataSchema,
} from "@ai/contracts/pack-contracts";
import type { QueryClient } from "@tanstack/react-query";
import { session } from "~/features/auth/lib/session";
import { meStream, type StreamFrame } from "~/platform/stream/me-stream";
import { msgKeys } from "../api";
import {
  applyDeletedToList,
  applyNewToList,
  bumpTotal,
  clearUnread,
  type ListPages,
} from "../lib/conversations";
import {
  applyDeleted,
  applyNewMessage,
  applyReadToMembers,
  type MsgPages,
} from "../lib/message-pages";

let viewing: string | null = null;
/** Hội thoại đang mở (ChatView đặt/bỏ): tin tới khi đang xem không cộng chưa đọc. */
export const setViewing = (id: string | null): void => {
  viewing = id;
};
const isViewing = (id: string): boolean =>
  viewing === id && (typeof document === "undefined" || document.visibilityState === "visible");

const parse = <T>(
  f: StreamFrame,
  s: { safeParse: (v: unknown) => { success: boolean; data?: T } },
): T | null => {
  try {
    const r = s.safeParse(JSON.parse(f.data));
    return r.success ? (r.data as T) : null;
  } catch {
    return null;
  }
};

function senderNameOf(qc: QueryClient, convId: string, senderId: string, list: ListPages): string {
  const c = list.pages.flatMap((p) => p.items).find((x) => x.id === convId);
  if (c?.kind === "direct") return c.peer?.name ?? "";
  const d = qc.getQueryData<ConversationDetail>(msgKeys.detail(convId));
  return d?.members.find((m) => m.user_id === senderId)?.name ?? "";
}

function onNew(qc: QueryClient, f: StreamFrame): void {
  const d = parse(f, MsgNewEventDataSchema);
  const myId = session.getState().me?.id;
  if (!d || !myId) return;
  const m = d.message;
  qc.setQueryData<MsgPages>(msgKeys.msgs(d.conversation_id), (old) =>
    old ? applyNewMessage(old, m) : old,
  );
  const mine = m.sender_id === myId;
  const viewingNow = isViewing(d.conversation_id);
  const list = qc.getQueryData<ListPages>(msgKeys.list);
  const name = list ? senderNameOf(qc, d.conversation_id, m.sender_id, list) : "";
  const res = list
    ? applyNewToList(list, m, { myId, viewing: viewingNow, senderName: mine ? "" : name })
    : null;
  if (res?.known) qc.setQueryData(msgKeys.list, res.data);
  // Hội thoại mới (chưa có trong cache) hoặc nhóm chưa biết tên người gửi ⇒ tải lại danh sách (một câu).
  if (!res?.known || (!mine && !name)) void qc.invalidateQueries({ queryKey: msgKeys.list });
  if (!mine && !viewingNow)
    qc.setQueryData<{ total: number }>(msgKeys.unread, (u) =>
      u ? { total: bumpTotal(u.total, 1) } : u,
    );
}

function onRead(qc: QueryClient, f: StreamFrame): void {
  const d = parse(f, MsgReadEventDataSchema);
  const myId = session.getState().me?.id;
  if (!d || !myId) return;
  if (d.user_id === myId) {
    // Tab khác của mình đã đọc ⇒ xoá chấm; tổng lấy lại (đúng hơn tự trừ).
    qc.setQueryData<ListPages>(msgKeys.list, (l) => (l ? clearUnread(l, d.conversation_id) : l));
    void qc.invalidateQueries({ queryKey: msgKeys.unread });
    return;
  }
  qc.setQueryData<ConversationDetail>(msgKeys.detail(d.conversation_id), (c) =>
    c ? { ...c, members: applyReadToMembers(c.members, d.user_id, d.seq) } : c,
  );
}

function onDeleted(qc: QueryClient, f: StreamFrame): void {
  const d = parse(f, MsgDeletedEventDataSchema);
  if (!d) return;
  qc.setQueryData<MsgPages>(msgKeys.msgs(d.conversation_id), (o) => applyDeleted(o, d.seq));
  qc.setQueryData<ListPages>(msgKeys.list, (l) =>
    l ? applyDeletedToList(l, d.conversation_id, d.seq) : l,
  );
  void qc.invalidateQueries({ queryKey: msgKeys.unread });
}

function onConversation(qc: QueryClient, f: StreamFrame): void {
  const d = parse(f, MsgConversationEventDataSchema);
  if (!d) return;
  void qc.invalidateQueries({ queryKey: msgKeys.list });
  void qc.invalidateQueries({ queryKey: msgKeys.detail(d.conversation_id) });
  void qc.invalidateQueries({ queryKey: msgKeys.unread });
}

let users = 0;
let stop: (() => void) | null = null;

/** Bắt đầu nghe (đếm số bên dùng); trả hàm dừng. Bên cuối dừng ⇒ huỷ đăng ký. */
export function retain(qc: QueryClient): () => void {
  if (users++ === 0) {
    const refetchAll = () => void qc.invalidateQueries({ queryKey: msgKeys.all });
    const offs = [
      meStream.subscribe("msg.new", (f) => onNew(qc, f), refetchAll),
      meStream.subscribe("msg.read", (f) => onRead(qc, f)),
      meStream.subscribe("msg.deleted", (f) => onDeleted(qc, f)),
      meStream.subscribe("msg.conversation", (f) => onConversation(qc, f)),
    ];
    stop = () => {
      for (const off of offs) off();
    };
  }
  let done = false;
  return () => {
    if (done) return;
    done = true;
    if (--users === 0) {
      stop?.();
      stop = null;
    }
  };
}

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
  senderNameFrom,
  unreadOf,
} from "../lib/conversations";
import {
  applyDeleted,
  applyNewMessage,
  applyReadToMembers,
  type MsgPages,
} from "../lib/message-pages";
import { createViewing } from "../lib/viewing";

const viewing = createViewing();
/** Khung chat mở / đóng hội thoại `id` (đóng chỉ xoá khi vẫn là `id`): tin tới khi đang xem không cộng chưa đọc. */
export const enterViewing = viewing.enter;
export const leaveViewing = viewing.leave;
const isViewing = (id: string): boolean =>
  viewing.current() === id &&
  (typeof document === "undefined" || document.visibilityState === "visible");

/** Tải lại danh sách GỘP: nhiều tin liên tiếp ⇒ một lần (không một lần mỗi tin). */
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
const REFRESH_COALESCE_MS = 300;
function scheduleListRefresh(qc: QueryClient): void {
  if (refreshTimer) return;
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    void qc.invalidateQueries({ queryKey: msgKeys.list });
  }, REFRESH_COALESCE_MS);
}

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
  const detail = qc.getQueryData<ConversationDetail>(msgKeys.detail(d.conversation_id));
  const name = senderNameFrom(list, detail?.members, d.conversation_id, m.sender_id);
  const res = list
    ? applyNewToList(list, m, { myId, viewing: viewingNow, senderName: mine ? "" : name })
    : null;
  if (res?.known) qc.setQueryData(msgKeys.list, res.data);
  // Hội thoại mới (chưa có trong cache) hoặc nhóm chưa biết tên người gửi ⇒ tải lại danh sách, GỘP (tên lấy từ dữ liệu có sẵn trước).
  if (!res?.known || (!mine && !name)) scheduleListRefresh(qc);
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
  // Tin bị thu hồi có thể là tin chưa đọc của mình ⇒ số chưa đọc của hội thoại đổi (client không biết mốc đọc) ⇒ tải lại danh sách gộp.
  if (unreadOf(qc.getQueryData<ListPages>(msgKeys.list), d.conversation_id) > 0)
    scheduleListRefresh(qc);
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

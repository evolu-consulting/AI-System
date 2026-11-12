// CR-132 M4 · HD-MSG-01..12 · luật thuần chọn NGƯỜI NHẬN + dựng khung sự kiện `msg.*` của `/me/stream` (spec §5). Không I/O: use case gọi SAU commit và đưa cả lô
// khung vào MỘT pipeline Redis. Người nhận luôn khử trùng; không còn ai ⇒ không có khung (không gọi Redis).
import type { Message, MsgConversationChange } from "@ai/contracts/pack-contracts";

type Data<E extends string, D> = { event: E; data: D };
export type MsgFrame = { userIds: string[] } & (
  | Data<"msg.new", { conversation_id: string; message: Message }>
  | Data<"msg.deleted", { conversation_id: string; seq: number }>
  | Data<"msg.read", { conversation_id: string; user_id: string; seq: number }>
  | Data<"msg.conversation", { conversation_id: string; change: MsgConversationChange }>
);

const uniq = (ids: readonly string[]): string[] => [...new Set(ids)];
const framed = <F extends MsgFrame>(userIds: readonly string[], f: Omit<F, "userIds">): F[] => {
  const ids = uniq(userIds);
  return ids.length === 0 ? [] : [{ ...f, userIds: ids } as F];
};

/** Tin mới: mọi thành viên (cả người gửi — tab khác của họ). */
export const newFrames = (
  cid: string,
  message: Message,
  memberIds: readonly string[],
): MsgFrame[] => framed(memberIds, { event: "msg.new", data: { conversation_id: cid, message } });

/** Thu hồi: mọi thành viên. */
export const deletedFrames = (cid: string, seq: number, memberIds: readonly string[]): MsgFrame[] =>
  framed(memberIds, { event: "msg.deleted", data: { conversation_id: cid, seq } });

/** Đã đọc: mọi thành viên (cập nhật «Đã xem»; tab khác của chính mình xoá chấm). */
export const readFrames = (
  cid: string,
  userId: string,
  seq: number,
  memberIds: readonly string[],
): MsgFrame[] =>
  framed(memberIds, { event: "msg.read", data: { conversation_id: cid, user_id: userId, seq } });

/**
 * Đổi hội thoại: người vừa vào (`added`) / vừa ra (`removed`) nhận khung riêng; người còn lại (`rest`) nhận `updated`.
 * Một người chỉ nhận MỘT khung (ưu tiên added/removed hơn updated).
 */
export function conversationFrames(
  cid: string,
  who: { added?: readonly string[]; removed?: readonly string[]; rest?: readonly string[] },
): MsgFrame[] {
  const added = uniq(who.added ?? []);
  const removed = uniq(who.removed ?? []).filter((u) => !added.includes(u));
  const rest = uniq(who.rest ?? []).filter((u) => !added.includes(u) && !removed.includes(u));
  const f = (change: MsgConversationChange, ids: string[]) =>
    framed<MsgFrame>(ids, { event: "msg.conversation", data: { conversation_id: cid, change } });
  return [...f("added", added), ...f("removed", removed), ...f("updated", rest)];
}

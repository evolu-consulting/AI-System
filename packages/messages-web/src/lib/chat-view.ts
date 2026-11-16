// CR-178 · luật thuần khung chat: gộp tin liên tiếp cùng người, vạch «Tin chưa đọc», đếm «n tin mới», «Đã xem» bằng avatar, thao tác trên tin. Không gọi mạng.
import type { ConversationMember, Message } from "@ai/contracts/pack-contracts";
import { type Row, stateOf } from "./rows";

/** Tin cùng người cách nhau quá ngần này ⇒ tách nhóm (hiện lại tên/giờ). */
export const GROUP_GAP_MS = 5 * 60_000;

export type RowGroup = {
  key: string;
  /** Người gửi; tin đang gửi/lỗi luôn là của mình. */
  senderId: string;
  mine: boolean;
  rows: Row[];
};

const senderOf = (r: Row, myId: string): string => (r.kind === "sent" ? r.m.sender_id : myId);

/** Gộp các dòng liên tiếp cùng người gửi, cách nhau ≤ `GROUP_GAP_MS` (`rows` là MỘT nhóm ngày); tin có seq = `breakSeq` (vạch «Tin chưa đọc») luôn mở nhóm mới. Tin đang gửi (của mình) nối vào nhóm cuối của mình. */
export function groupRows(
  rows: readonly Row[],
  myId: string,
  breakSeq: number | null = null,
): RowGroup[] {
  const out: RowGroup[] = [];
  for (const r of rows) {
    const sender = senderOf(r, myId);
    const last = out[out.length - 1];
    const prev = last?.rows[last.rows.length - 1];
    const near =
      prev && r.kind === "sent" && prev.kind === "sent"
        ? Date.parse(r.m.at) - Date.parse(prev.m.at) <= GROUP_GAP_MS
        : prev !== undefined;
    const brk = breakSeq !== null && r.kind === "sent" && r.m.seq === breakSeq;
    if (last && last.senderId === sender && near && !brk) last.rows.push(r);
    else out.push({ key: r.key, senderId: sender, mine: sender === myId, rows: [r] });
  }
  return out;
}

/** Tin cuối của nhóm là tin đã gửi ⇒ hiện giờ dưới nó; tin đang gửi/lỗi không có giờ. */
export function groupTime(g: RowGroup): string | null {
  const last = g.rows[g.rows.length - 1];
  return last && last.kind === "sent" && stateOf(last) === "sent" ? last.m.at : null;
}

/**
 * Mốc vạch «Tin chưa đọc» = seq của tin ĐẦU TIÊN của người khác sau mốc đọc lúc mở cuộc (`readAt`); không có ⇒ null.
 * `readAt` null (chưa biết) ⇒ null (không vẽ vạch).
 */
export function unreadDividerSeq(
  items: readonly Message[],
  readAt: number | null,
  myId: string,
): number | null {
  if (readAt == null) return null;
  const m = items.find((x) => x.seq > readAt && x.sender_id !== myId);
  return m ? m.seq : null;
}

/** Số tin của người khác mới hơn mốc `seenSeq` (tin đã thấy khi còn ở đáy) — số trên nút «↓ n tin mới». */
export function newBelowCount(items: readonly Message[], seenSeq: number, myId: string): number {
  let n = 0;
  for (const m of items) if (m.seq > seenSeq && m.sender_id !== myId && !m.deleted) n++;
  return n;
}

/** Người khác đã đọc tới tin cuối của mình ⇒ avatar nhỏ: tối đa `max`, phần dư là «+N» (do AvatarGroup vẽ). */
export function seenPeople(
  mineSeq: number | null,
  members: readonly ConversationMember[],
  myId: string,
): ConversationMember[] {
  if (mineSeq == null) return [];
  return members.filter((x) => x.user_id !== myId && x.last_read_seq >= mineSeq);
}

export type MessageAction = "copy" | "revoke";

/** «⋯» của một tin: Sao chép khi còn chữ; Thu hồi chỉ tin của mình chưa thu hồi (server vẫn là nơi quyết định). */
export function messageActions(
  m: Pick<Message, "sender_id" | "deleted" | "body">,
  myId: string,
): MessageAction[] {
  if (m.deleted) return [];
  const out: MessageAction[] = [];
  if (m.body.trim() !== "") out.push("copy");
  if (m.sender_id === myId) out.push("revoke");
  return out;
}

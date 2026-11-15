// CR-132 · W2 · luật thuần của danh sách hội thoại: sắp xếp, in đậm, số chưa đọc, tên hiển thị, xem trước, áp sự kiện realtime vào cache.
import {
  type ConversationSummary,
  type Message,
  MSG_UNREAD_CONV_CAP,
  MSG_UNREAD_CONV_MAX,
  MSG_UNREAD_TOTAL_MAX,
  messagePreview,
} from "@ai/contracts/pack-contracts";
import { foldText } from "./format";

export type ListPages = {
  pages: { items: ConversationSummary[]; next_cursor: string | null }[];
  pageParams?: unknown[];
};

export const isUnread = (c: Pick<ConversationSummary, "unread">): boolean => c.unread > 0;

/** Chữ số chưa đọc: 0 ⇒ null (không hiện); trên 99 (server trả 100) ⇒ «99+». */
export function unreadLabel(n: number, max = MSG_UNREAD_CONV_MAX): string | null {
  if (n <= 0) return null;
  return n > max ? `${max}+` : String(n);
}

/** Tin mới nhất lên đầu (cùng giờ ⇒ theo id cho ổn định). */
export const sortConversations = (items: readonly ConversationSummary[]): ConversationSummary[] =>
  [...items].sort((a, b) =>
    a.last_at === b.last_at ? b.id.localeCompare(a.id) : a.last_at < b.last_at ? 1 : -1,
  );

export const convTitle = (c: Pick<ConversationSummary, "kind" | "title" | "peer">): string =>
  c.kind === "group" ? (c.title ?? "") : (c.peer?.name ?? "");

/** Lọc theo tên người/nhóm, không phân biệt hoa thường và dấu. */
export function filterConversations(
  items: readonly ConversationSummary[],
  q: string,
): ConversationSummary[] {
  const needle = foldText(q.trim());
  return needle ? items.filter((c) => foldText(convTitle(c)).includes(needle)) : [...items];
}

export type PreviewKind = "deleted" | "files" | "mine" | "other" | "none";
/** Xem trước: tách phần chọn câu (i18n ở component) khỏi dữ liệu. */
export function previewOf(
  c: Pick<ConversationSummary, "last_message" | "kind">,
  myId: string,
): { kind: PreviewKind; who: string; text: string } {
  const m = c.last_message;
  if (!m) return { kind: "none", who: "", text: "" };
  if (m.deleted) return { kind: "deleted", who: "", text: "" };
  if (!m.preview && m.has_files) return { kind: "files", who: "", text: "" };
  const mine = m.sender_id === myId;
  return {
    kind: mine ? "mine" : "other",
    // 1-1: tin của người kia không cần ghi tên; nhóm thì ghi.
    who: mine || c.kind === "direct" ? "" : m.sender_name,
    text: m.preview,
  };
}

type Last = NonNullable<ConversationSummary["last_message"]>;
const lastOf = (m: Message, senderName: string): Last => ({
  seq: m.seq,
  sender_id: m.sender_id,
  sender_name: senderName,
  preview: messagePreview(m.body),
  has_files: m.files.length > 0,
  deleted: m.deleted,
  at: m.at,
});

/** Cộng/trừ vào tổng chưa đọc, kẹp 0..999. */
export const bumpTotal = (total: number, d: number): number =>
  Math.max(0, Math.min(MSG_UNREAD_TOTAL_MAX, total + d));

export type NewCtx = { myId: string; viewing: boolean; senderName: string };

/** `msg.new`: cập nhật xem trước + giờ, đưa lên đầu; chưa đọc +1 nếu của người khác và không đang xem. `known=false` ⇒ chưa có trong cache (tải lại danh sách). */
export function applyNewToList(
  list: ListPages,
  m: Message,
  ctx: NewCtx,
): { data: ListPages; known: boolean } {
  let found: ConversationSummary | undefined;
  const pages = list.pages.map((p) => ({
    ...p,
    items: p.items.filter((c) => {
      if (c.id !== m.conversation_id) return true;
      found = c;
      return false;
    }),
  }));
  if (!found) return { data: list, known: false };
  const bump = m.sender_id !== ctx.myId && !ctx.viewing ? 1 : 0;
  const next: ConversationSummary = {
    ...found,
    last_message: lastOf(m, ctx.senderName),
    last_at: m.at,
    unread: Math.min(MSG_UNREAD_CONV_CAP, found.unread + bump),
  };
  const [first, ...rest] = pages;
  if (!first) return { data: list, known: false };
  return {
    data: { ...list, pages: [{ ...first, items: [next, ...first.items] }, ...rest] },
    known: true,
  };
}

/** Xoá chấm chưa đọc của một hội thoại (mình đã đọc — mở hội thoại hoặc tab khác báo). */
export function clearUnread(list: ListPages, id: string): ListPages {
  return {
    ...list,
    pages: list.pages.map((p) => ({
      ...p,
      items: p.items.map((c) => (c.id === id && c.unread > 0 ? { ...c, unread: 0 } : c)),
    })),
  };
}

/** `msg.deleted` trúng tin cuối ⇒ xem trước thành «Tin nhắn đã được thu hồi». */
export function applyDeletedToList(list: ListPages, id: string, seq: number): ListPages {
  return {
    ...list,
    pages: list.pages.map((p) => ({
      ...p,
      items: p.items.map((c) =>
        c.id === id && c.last_message?.seq === seq
          ? {
              ...c,
              last_message: { ...c.last_message, deleted: true, preview: "", has_files: false },
            }
          : c,
      ),
    })),
  };
}

/** Gộp các trang thành một danh sách phẳng (không trùng id). */
export function flattenList(list: ListPages | undefined): ConversationSummary[] {
  const seen = new Set<string>();
  const out: ConversationSummary[] = [];
  for (const p of list?.pages ?? [])
    for (const c of p.items)
      if (!seen.has(c.id)) {
        seen.add(c.id);
        out.push(c);
      }
  return out;
}

/** Số chưa đọc của một hội thoại trong cache (không có ⇒ 0). */
export function unreadOf(list: ListPages | undefined, id: string): number {
  return flattenList(list).find((c) => c.id === id)?.unread ?? 0;
}

/**
 * Tên người gửi từ dữ liệu SẴN CÓ (không gọi mạng): 1-1 ⇒ tên người kia; nhóm ⇒ chi tiết đã tải (thành viên), rồi tin cuối cùng người gửi
 * (`last_message.sender_name`). Không biết ⇒ "" (xem trước vẫn đúng chữ, chỉ thiếu tên; danh sách được tải lại gộp một lần).
 */
export function senderNameFrom(
  list: ListPages | undefined,
  members: readonly { user_id: string; name: string }[] | undefined,
  convId: string,
  senderId: string,
): string {
  const c = flattenList(list).find((x) => x.id === convId);
  if (c?.kind === "direct") return c.peer?.name ?? "";
  const fromMember = members?.find((m) => m.user_id === senderId)?.name;
  if (fromMember) return fromMember;
  return c?.last_message?.sender_id === senderId ? c.last_message.sender_name : "";
}

// CR-190 · dữ liệu hiển thị một dòng danh bạ: tên, dòng phụ «chức vụ · công ty», tin cuối hoặc «Chưa có tin nhắn» (không giờ), chưa đọc, ghim.
import type { ConversationSummary, MsgDirRow } from "@ai/contracts/pack-contracts";
import { convTitle, unreadLabel } from "./conversations";

export type DirRowView = {
  key: string;
  title: string;
  /** Chức vụ · công ty (công ty chỉ ở nhóm không phải đối tác); rỗng ⇒ không vẽ dòng phụ. */
  sub: string;
  /** Chưa từng nhắn ⇒ xem trước là «Chưa có tin nhắn», không giờ. */
  hasMessage: boolean;
  /** Giờ tin cuối; chưa có tin ⇒ null. */
  at: string | null;
  unread: number;
  unreadText: string | null;
  pinned: boolean;
  isGroup: boolean;
  personId: string | null;
  /** Người nghỉ / công ty đã ngắt ⇒ chỉ còn lịch sử. */
  readOnly: boolean;
};

export function dirRowView(r: MsgDirRow, showCompany: boolean): DirRowView {
  const c: ConversationSummary | null = r.conversation;
  const p = r.person;
  const title = p?.name ?? (c ? convTitle(c) : "");
  const job = (p?.job_title ?? c?.peer?.job_title ?? "").trim();
  const company = showCompany ? (p?.company.name ?? c?.company?.name ?? "").trim() : "";
  const unread = c?.unread ?? 0;
  return {
    key: r.key,
    title,
    sub: [job, company].filter(Boolean).join(" · "),
    hasMessage: Boolean(c?.last_message),
    at: c?.last_message?.at ?? null,
    unread,
    unreadText: unreadLabel(unread),
    pinned: Boolean(c?.pinned_at),
    isGroup: c ? c.kind === "group" : !p,
    personId: p?.id ?? (c && c.kind !== "group" ? (c.peer?.id ?? null) : null),
    readOnly: Boolean(c?.read_only) || (p ? !p.active : false),
  };
}

/** «⋯» chỉ có khi cuộc đã tồn tại: chưa từng nhắn ⇒ chưa có gì để ghim/đánh dấu. */
export const canAct = (r: MsgDirRow): boolean => r.conversation !== null;

/** Đang chưa đọc (thật hoặc cờ) ⇒ nút «Đánh dấu đã đọc»; ngược lại «Đánh dấu chưa đọc». */
export const markIsRead = (c: Pick<ConversationSummary, "unread">): boolean => c.unread > 0;

/** Dòng cho danh sách «Chưa đọc» (cuộc phẳng, không có danh bạ): cùng hình dòng với danh bạ. */
export const convToRow = (c: ConversationSummary): MsgDirRow => ({
  key: `c:${c.id}`,
  conversation: c,
  person: null,
});

// CR-190 · luật thuần danh bạ nhóm của trang Tin nhắn: sắp xếp dòng (ghim → tin mới nhất → chưa nhắn theo tên A→Z), áp sự kiện realtime / ghim / đọc
// vào dữ liệu `GET /messages/directory` đã tải (không gọi mạng), gộp trang «Xem thêm», «Xem thêm (n)».
import type {
  ConversationSummary,
  ConvPrefs,
  Message,
  MsgDirectoryResponse,
  MsgDirGroup,
  MsgDirRow,
} from "@ai/contracts/pack-contracts";
import { applyNewToConv, bumpTotal, type NewCtx } from "./conversations";
import { foldText } from "./format";

export type DirData = MsgDirectoryResponse;

export const rowName = (r: MsgDirRow): string => r.person?.name ?? r.conversation?.title ?? "";

/** 0 = ghim · 1 = đã có tin · 2 = chưa có tin. */
export function rowTier(r: MsgDirRow): 0 | 1 | 2 {
  const c = r.conversation;
  if (c?.pinned_at) return 0;
  return c?.last_message ? 1 : 2;
}

/** Ghim → tin mới nhất → chưa từng nhắn theo tên A→Z (đúng thứ tự máy chủ). Trong nhóm ghim vẫn theo tin mới nhất. */
export function compareRows(a: MsgDirRow, b: MsgDirRow): number {
  const ta = rowTier(a);
  const tb = rowTier(b);
  if (ta !== tb) return ta - tb;
  if (ta === 2) return foldText(rowName(a)).localeCompare(foldText(rowName(b)), "vi");
  const la = a.conversation?.last_at ?? "";
  const lb = b.conversation?.last_at ?? "";
  return la === lb ? a.key.localeCompare(b.key) : la < lb ? 1 : -1;
}

const sortRows = (items: readonly MsgDirRow[]): MsgDirRow[] => [...items].sort(compareRows);

function withGroup(d: DirData, key: string, fn: (g: MsgDirGroup) => MsgDirGroup): DirData {
  return { groups: d.groups.map((g) => (g.key === key ? fn(g) : g)) };
}

/** Dòng đang giữ cuộc `convId` (kèm nhóm); không có ⇒ null. */
export function findRow(d: DirData, convId: string): { group: MsgDirGroup; row: MsgDirRow } | null {
  for (const group of d.groups) {
    const row = group.items.find((r) => r.conversation?.id === convId);
    if (row) return { group, row };
  }
  return null;
}

/**
 * Thay cuộc của một dòng bằng `fn(cuộc)`, cập nhật chưa đọc của nhóm, sắp lại phần đã tải của nhóm đó (phần chưa tải do máy chủ lo).
 * Không thấy cuộc ⇒ giữ nguyên, `known=false` (người gọi tải lại danh bạ).
 */
export function patchConversation(
  d: DirData,
  convId: string,
  fn: (c: ConversationSummary) => ConversationSummary,
): { data: DirData; known: boolean } {
  const hit = findRow(d, convId);
  const before = hit?.row.conversation;
  if (!hit || !before) return { data: d, known: false };
  const after = fn(before);
  return {
    known: true,
    data: withGroup(d, hit.group.key, (g) => ({
      ...g,
      unread: bumpTotal(g.unread, after.unread - before.unread),
      items: sortRows(
        g.items.map((r) => (r.conversation?.id === convId ? { ...r, conversation: after } : r)),
      ),
    })),
  };
}

/** `msg.new`: dòng nhảy lên đầu nhóm, xem trước + chưa đọc cập nhật. */
export const applyNewToDir = (
  d: DirData,
  m: Message,
  ctx: NewCtx,
): { data: DirData; known: boolean } =>
  patchConversation(d, m.conversation_id, (c) => applyNewToConv(c, m, ctx));

export const clearUnreadInDir = (d: DirData, convId: string): DirData =>
  patchConversation(d, convId, (c) => ({ ...c, unread: 0, marked_unread: false })).data;

export const applyDeletedToDir = (d: DirData, convId: string, seq: number): DirData =>
  patchConversation(d, convId, (c) =>
    c.last_message?.seq === seq
      ? { ...c, last_message: { ...c.last_message, deleted: true, preview: "", has_files: false } }
      : c,
  ).data;

/** Ghim / cờ chưa đọc vừa đổi ở máy chủ. Cờ bật mà chưa có tin chưa đọc thật ⇒ hiện 1 (cùng luật máy chủ: max(thật, cờ)). */
export const applyPrefsToDir = (d: DirData, convId: string, p: ConvPrefs): DirData =>
  patchConversation(d, convId, (c) => ({
    ...c,
    pinned_at: p.pinned_at,
    marked_unread: p.marked_unread,
    unread: p.marked_unread ? Math.max(c.unread, 1) : c.unread,
  })).data;

/** «Xem thêm (n)»: số còn lại chưa tải của nhóm. */
export const remaining = (g: Pick<MsgDirGroup, "total" | "items">): number =>
  Math.max(0, g.total - g.items.length);

/** Gộp trang kế của một nhóm vào cuối (bỏ dòng trùng), giữ nguyên thứ tự máy chủ. */
export function appendPage(
  d: DirData,
  key: string,
  page: Pick<MsgDirGroup, "items" | "next_cursor">,
): DirData {
  return withGroup(d, key, (g) => {
    const seen = new Set(g.items.map((r) => r.key));
    return {
      ...g,
      items: [...g.items, ...page.items.filter((r) => !seen.has(r.key))],
      next_cursor: page.next_cursor,
    };
  });
}

/** Cuộc đã có ở mọi nhóm (để tra tên người gửi) — không dùng để vẽ. */
export const dirConversations = (d: DirData | undefined): ConversationSummary[] =>
  (d?.groups ?? []).flatMap((g) =>
    g.items.flatMap((r) => (r.conversation ? [r.conversation] : [])),
  );

/** Trạng thái thân cột trái: chưa có danh bạ ⇒ chờ/lỗi; có danh bạ (kể cả cũ) ⇒ sẵn sàng, trừ khi danh sách «Chưa đọc» đang xem bị lỗi. */
export const bodyStatus = (
  hasDir: boolean,
  dirError: boolean,
  unreadError: boolean,
): "loading" | "error" | "ready" => {
  if (!hasDir) return dirError ? "error" : "loading";
  return unreadError ? "error" : "ready";
};

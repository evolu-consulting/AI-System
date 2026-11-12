// Logic thuần của bình luận (CR-129): ai được sửa/xoá/ẩn, và luật nhắc tên «@» (nhận biết đang gõ, chèn, giữ lại, tách để tô đậm).
import type { CommentView, Mention } from "@ai/contracts/community";

export type CommentActions = { edit: boolean; delete: boolean; hide: boolean };

/** Người viết sửa/xoá bình luận của mình; chủ quản ẩn/hiện mọi bình luận trên bài chủ quản (HT-46). */
export function commentActions(
  c: Pick<CommentView, "mine">,
  ctx: { isHost: boolean; postByHost: boolean },
): CommentActions {
  return { edit: c.mine, delete: c.mine, hide: ctx.isHost && ctx.postByHost };
}

const QUERY_MAX = 40;

/** Đang gõ nhắc tên? `@` ở đầu dòng/sau khoảng trắng, tới con trỏ không có xuống dòng hay `@` khác. Trả vị trí `@` + chữ đã gõ. */
export function activeMention(
  text: string,
  caret: number,
): { start: number; query: string } | null {
  const head = text.slice(0, caret);
  const at = head.lastIndexOf("@");
  if (at < 0) return null;
  if (at > 0 && !/\s/.test(head.charAt(at - 1))) return null;
  const query = head.slice(at + 1);
  if (query.length > QUERY_MAX || /[\n@]/.test(query)) return null;
  return { start: at, query };
}

/** Chọn một gợi ý: thay `@chữ-đang-gõ` bằng `@Tên ` và trả con trỏ mới (sau dấu cách). */
export function insertMention(
  text: string,
  start: number,
  caret: number,
  name: string,
): { text: string; caret: number } {
  const ins = `@${name} `;
  return { text: text.slice(0, start) + ins + text.slice(caret), caret: start + ins.length };
}

/** Id công ty gửi lên: chỉ những người đã chọn mà `@Tên` còn nguyên trong chữ (xoá chữ ⇒ bỏ nhắc), không trùng, tối đa `max`. */
export function mentionIds(text: string, picked: Mention[], max = 10): string[] {
  const ids: string[] = [];
  for (const m of picked)
    if (text.includes(`@${m.name}`) && !ids.includes(m.orgId)) ids.push(m.orgId);
  return ids.slice(0, max);
}

export type TextPart = { text: string; mention: boolean };

/** Tách bình luận đã gửi thành đoạn thường / đoạn `@Tên` (tên dài nhất khớp trước) để tô đậm. */
export function splitMentions(text: string, mentions: Pick<Mention, "name">[]): TextPart[] {
  const names = [...new Set(mentions.map((m) => `@${m.name}`))].sort((a, b) => b.length - a.length);
  if (names.length === 0) return [{ text, mention: false }];
  const out: TextPart[] = [];
  let i = 0;
  let buf = "";
  while (i < text.length) {
    const hit = names.find((n) => text.startsWith(n, i));
    if (hit) {
      if (buf) out.push({ text: buf, mention: false });
      buf = "";
      out.push({ text: hit, mention: true });
      i += hit.length;
    } else {
      buf += text.charAt(i);
      i++;
    }
  }
  if (buf) out.push({ text: buf, mention: false });
  return out;
}

/** Lọc gợi ý theo chữ gõ (không phân biệt hoa/thường); server đã lọc, đây chỉ để mượt khi gõ tiếp. */
export const filterMentionables = (list: Mention[], q: string): Mention[] => {
  const k = q.trim().toLowerCase();
  return k ? list.filter((m) => m.name.toLowerCase().includes(k)) : list;
};

/** Gợi ý đang chọn sau phím ↑/↓ (vòng tròn). */
export const moveIndex = (cur: number, dir: 1 | -1, len: number): number =>
  len === 0 ? 0 : (cur + dir + len) % len;

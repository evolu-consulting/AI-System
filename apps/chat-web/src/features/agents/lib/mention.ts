// HUB-FR-91 · luật thuần menu `@` (plan-frontend §1.2): khi nào mở, lọc, điền tag.
import type { AgentMenuItem } from "@ai/contracts/chat";

/** Tag đầy đủ `@key` (không phải `@@`). */
const TAG = /^@[^\s@]\S*$/;

/** Vị trí [start, end) của token chứa con trỏ. */
function tokenAt(text: string, caret: number): { start: number; end: number } {
  const c = Math.min(Math.max(caret, 0), text.length);
  let start = c;
  while (start > 0 && !/\s/.test(text[start - 1] as string)) start--;
  let end = c;
  while (end < text.length && !/\s/.test(text[end] as string)) end++;
  return { start, end };
}

/**
 * Phần gõ sau `@` khi menu phải mở: token tại con trỏ bắt đầu `@` (không `@@`) và mọi token trước nó đều là tag.
 * Trả `null` khi không mở.
 */
export function mentionQuery(text: string, caret: number): string | null {
  const { start, end } = tokenAt(text, caret);
  const token = text.slice(start, Math.min(Math.max(caret, start), end));
  if (!token.startsWith("@") || token.startsWith("@@")) return null;
  const before = text.slice(0, start).split(/\s+/).filter(Boolean);
  if (!before.every((tok) => TAG.test(tok))) return null;
  return token.slice(1);
}

export type AgentMatch = { item: AgentMenuItem };

const nameOf = (item: AgentMenuItem, lang: string) =>
  lang.toLowerCase().startsWith("en") ? item.name.en : item.name.vi;

/** Tiền tố `key` hoặc chứa trong tên theo ngôn ngữ, không phân biệt hoa thường; sắp theo `key`. */
export function filterAgents(
  items: readonly AgentMenuItem[],
  q: string,
  lang: string,
): AgentMatch[] {
  const needle = q.toLowerCase();
  return items
    .filter(
      (i) =>
        i.key.toLowerCase().startsWith(needle) || nameOf(i, lang).toLowerCase().includes(needle),
    )
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .map((item) => ({ item }));
}

export const agentName = nameOf;

/** Điền `@key ` thay token tại con trỏ, giữ phần sau; con trỏ ngay sau khoảng trắng. */
export function fillAgent(
  text: string,
  caret: number,
  key: string,
): { text: string; caret: number } {
  const { start, end } = tokenAt(text, caret);
  const rest = text.slice(end).trimStart();
  const head = `${text.slice(0, start)}@${key} `;
  return { text: head + rest, caret: head.length };
}

/** Tag ở đầu tin (`@a xin chào` → `a`); `@@x` và tin thường → `null`. */
export function leadingTag(text: string): string | null {
  return /^@([^\s@]\S*)/.exec(text)?.[1] ?? null;
}

/** Đổi tag `@old` thành `@name` (gợi ý "Ý bạn là"): giữ phần còn lại. */
export function replaceTag(text: string, old: string, name: string): string {
  const esc = old.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.replace(new RegExp(`(^|\\s)@${esc}(?=\\s|$)`), `$1@${name}`);
}

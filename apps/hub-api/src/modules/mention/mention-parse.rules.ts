// HUB-FR-91 · H2b-R01, AC-01 · phân loại tin E12: lệnh `/`, tag `@`, chữ thường (plan-rules, plan P4). Thuần.
// `classifyMessage` (H2a, test khoá) giữ nguyên — `routeMessage` bọc nó.
import { classifyMessage } from "../commands/command-parse.rules";

export type Routed =
  | { kind: "text"; content: string }
  | { kind: "command"; name: string; rest: string }
  | { kind: "mention"; tags: string[]; content: string }
  | { kind: "mention_error"; reason: "empty_tag" };

/** Khoảng trắng ASCII (như `classifyMessage`; U+00A0 và khoảng trắng Unicode khác không tách). */
const WS = new Set([" ", "\t", "\n", "\r", "\f", "\v"]);
const LEADING_WS = /^[ \t\n\r\f\v]+/;
const TRAILING_WS = /[ \t\n\r\f\v]+$/;

const trimAscii = (s: string): string => s.replace(LEADING_WS, "").replace(TRAILING_WS, "");

export type MentionRouted = Extract<Routed, { kind: "mention" | "mention_error" }>;

/** R01: `/` → `classifyMessage` nguyên văn; `@@` → chữ (bỏ một `@`); `@` → `parseMention`; khác → chữ nguyên văn. */
export function routeMessage(content: string): Routed {
  const s = content.replace(LEADING_WS, "");
  if (s.startsWith("/")) return classifyMessage(content);
  if (s.startsWith("@@")) return { kind: "text", content: s.slice(1) };
  if (s.startsWith("@")) return parseMention(s);
  return { kind: "text", content };
}

/** Vị trí kết thúc token bắt đầu tại `i` (token = chuỗi giữa khoảng trắng ASCII). */
function tokenEnd(s: string, i: number): number {
  let j = i;
  while (j < s.length && !WS.has(s.charAt(j))) j++;
  return j;
}

function skipWs(s: string, i: number): number {
  let j = i;
  while (j < s.length && WS.has(s.charAt(j))) j++;
  return j;
}

/**
 * R01: token `@x` liên tiếp đầu tin → `tags` (phần sau `@`, lower, gộp trùng giữ thứ tự đầu); `@` trơn ở đầu →
 * `empty_tag`, ở sau → dừng (là nội dung). `content` = phần sau token tag cuối, trim hai đầu (khoảng trắng ASCII).
 */
export function parseMention(s: string): Routed {
  const tags: string[] = [];
  let i = skipWs(s, 0);
  let lastEnd = i;
  while (i < s.length && s.charAt(i) === "@") {
    const end = tokenEnd(s, i);
    if (end - i === 1) {
      if (tags.length === 0) return { kind: "mention_error", reason: "empty_tag" };
      break;
    }
    const tag = s.slice(i + 1, end).toLowerCase();
    if (!tags.includes(tag)) tags.push(tag);
    lastEnd = end;
    i = skipWs(s, end);
  }
  if (tags.length === 0) return { kind: "mention_error", reason: "empty_tag" };
  return { kind: "mention", tags, content: trimAscii(s.slice(lastEnd)) };
}

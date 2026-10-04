// HUB-FR-11, HUB-BR-01 · H2a-R01, R05 · tách tin thường / lệnh `/`, tách token, gán tham số (plan-rules). Thuần.
import type { CommandArg } from "@ai/contracts";
import type { MessageContext } from "@ai/contracts/chat";

export type ClassifiedMessage =
  | { kind: "text"; content: string }
  | { kind: "command"; name: string; rest: string };

export type BoundArgs = { values: Record<string, string | null>; extra: number };

/** Khoảng trắng ASCII (U+00A0 và khoảng trắng Unicode khác không tách — Q-T10). */
const WS = new Set([" ", "\t", "\n", "\r", "\f", "\v"]);
const LEADING_WS = /^[ \t\n\r\f\v]+/;

/** Trim đầu; `//…` → text bỏ một `/`; `name` lower, có thể `""`. */
export function classifyMessage(content: string): ClassifiedMessage {
  const s = content.replace(LEADING_WS, "");
  if (!s.startsWith("/")) return { kind: "text", content };
  if (s.startsWith("//")) return { kind: "text", content: s.slice(1) };
  const body = s.slice(1);
  let end = 0;
  while (end < body.length && !WS.has(body.charAt(end))) end++;
  return {
    kind: "command",
    name: body.slice(0, end).toLowerCase(),
    rest: body.slice(end).replace(LEADING_WS, ""),
  };
}

type Token = { text: string; start: number };

type Read = { text: string; next: number };

/** `"…"` bắt đầu tại `i`: `\"` thoát, ngoặc không đóng → tới hết chuỗi (Q-T9). */
function readQuoted(s: string, i: number): Read {
  let text = "";
  let j = i + 1;
  while (j < s.length) {
    const ch = s.charAt(j);
    if (ch === '"') return { text, next: j + 1 };
    const esc = ch === "\\" && s.charAt(j + 1) === '"';
    text += esc ? '"' : ch;
    j += esc ? 2 : 1;
  }
  return { text, next: j };
}

/** Token trần tới khoảng trắng ASCII kế tiếp (`\"` → `"`). */
function readBare(s: string, i: number): Read {
  let text = "";
  let j = i;
  while (j < s.length && !WS.has(s.charAt(j))) {
    const esc = s.charAt(j) === "\\" && s.charAt(j + 1) === '"';
    text += esc ? '"' : s.charAt(j);
    j += esc ? 2 : 1;
  }
  return { text, next: j };
}

function scan(s: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < s.length) {
    if (WS.has(s.charAt(i))) {
      i++;
      continue;
    }
    const t = s.charAt(i) === '"' ? readQuoted(s, i) : readBare(s, i);
    out.push({ text: t.text, start: i });
    i = t.next;
  }
  return out;
}

/** Tách theo khoảng trắng ASCII; `"…"` là một token; `\"` thoát ngoặc; ngoặc không đóng → tới hết chuỗi. */
export function tokenize(rest: string): string[] {
  return scan(rest).map((t) => t.text);
}

function missingValue(a: CommandArg, ctx: MessageContext): string | null {
  if (a.default !== null) return a.default;
  if (a.fallback !== null) return ctx[a.fallback] ?? null;
  return null;
}

/** R05: vị trí → `default` → `fallback` (`ctx`) → `null`; `rest=true` lấy nguyên văn phần còn lại, trim hai đầu. */
export function bindArgs(
  args: readonly CommandArg[],
  rest: string,
  ctx: MessageContext,
): BoundArgs {
  const tokens = scan(rest);
  const values: Record<string, string | null> = {};
  let hasRest = false;
  args.forEach((a, i) => {
    const t = tokens[i];
    if (!t) values[a.name] = missingValue(a, ctx);
    else if (a.rest) {
      hasRest = true;
      values[a.name] = rest.slice(t.start).trim();
    } else values[a.name] = t.text;
  });
  const extra = hasRest ? 0 : Math.max(0, tokens.length - args.length);
  return { values, extra };
}

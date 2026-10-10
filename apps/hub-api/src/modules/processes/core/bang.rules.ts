// HUB-BR-28 · M2 · cú pháp `!` bắt đầu quy trình (plan §7, plan-contract §7). Thuần. Khoảng trắng ASCII như `routeMessage`
// (U+00A0 không tách); namespace riêng: `/` và `@` không bị ảnh hưởng.
import { PROCESS_KEY_RE } from "@ai/contracts/chat";

export type Bang =
  | { kind: "none" }
  | { kind: "escaped"; content: string }
  | { kind: "invalid"; token: string }
  | { kind: "process"; key: string; input: string };

const LEADING_WS = /^[ \t\n\r\f\v]+/;
const TRAILING_WS = /[ \t\n\r\f\v]+$/;
const WS_AT = /[ \t\n\r\f\v]/;

/** `!!…` ⇒ chữ bỏ một `!` · `!key input` ⇒ process (key chữ thường) · `!` trơn / key sai dạng ⇒ invalid · khác ⇒ none. */
export function classifyBang(content: string): Bang {
  const s = content.replace(LEADING_WS, "");
  if (!s.startsWith("!")) return { kind: "none" };
  if (s.startsWith("!!")) return { kind: "escaped", content: s.slice(1) };
  const rest = s.slice(1);
  const ws = rest.search(WS_AT);
  const token = ws < 0 ? rest : rest.slice(0, ws);
  const key = token.toLowerCase();
  if (!PROCESS_KEY_RE.test(key)) return { kind: "invalid", token };
  const input = ws < 0 ? "" : rest.slice(ws).replace(LEADING_WS, "").replace(TRAILING_WS, "");
  return { kind: "process", key, input };
}

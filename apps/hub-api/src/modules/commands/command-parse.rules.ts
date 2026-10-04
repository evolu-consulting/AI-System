// HUB-FR-11, HUB-BR-01 · H2a-R01, R05 · tách tin thường / lệnh `/`, tách token, gán tham số (plan-rules). Thuần.
// B0: chỉ chữ ký — thân làm ở B3 (qc viết test đỏ trước).
import type { CommandArg } from "@ai/contracts";
import type { MessageContext } from "@ai/contracts/chat";

export type ClassifiedMessage =
  | { kind: "text"; content: string }
  | { kind: "command"; name: string; rest: string };

export type BoundArgs = { values: Record<string, string | null>; extra: number };

/** Trim đầu; `//…` → text bỏ một `/`; `name` lower, có thể `""`. */
export function classifyMessage(content: string): ClassifiedMessage {
  throw new Error(`not implemented: classifyMessage(${content.length})`);
}

/** Tách theo khoảng trắng ASCII; `"…"` là một token; `\"` thoát ngoặc. */
export function tokenize(rest: string): string[] {
  throw new Error(`not implemented: tokenize(${rest.length})`);
}

/** R05: vị trí → `default` → `fallback` (`ctx`) → `null`; `rest=true` lấy nguyên văn phần còn lại, trim hai đầu. */
export function bindArgs(
  args: readonly CommandArg[],
  rest: string,
  ctx: MessageContext,
): BoundArgs {
  throw new Error(`not implemented: bindArgs(${args.length}, ${rest.length}, ${typeof ctx})`);
}

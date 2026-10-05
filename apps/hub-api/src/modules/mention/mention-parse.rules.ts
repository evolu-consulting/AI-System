// HUB-FR-91 · H2b-R01, AC-01 · phân loại tin E12: lệnh `/`, tag `@`, chữ thường (plan-rules). Thuần.
// B0: chỉ chữ ký (B4).

export type Routed =
  | { kind: "text"; content: string }
  | { kind: "command"; name: string; rest: string }
  | { kind: "mention"; tags: string[]; content: string }
  | { kind: "mention_error"; reason: "empty_tag" };

/** R01: `/` → `classifyMessage` nguyên văn; `@@` → chữ (bỏ một `@`); `@` → `parseMention`; khác → chữ nguyên văn. */
export function routeMessage(_content: string): Routed {
  throw new Error("not implemented: routeMessage");
}

/** R01: token `@` liên tiếp đầu tin → `tags` (lower, gộp trùng); `@` trơn ở đầu → `empty_tag`. */
export function parseMention(_s: string): Routed {
  throw new Error("not implemented: parseMention");
}

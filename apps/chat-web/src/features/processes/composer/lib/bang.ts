// CR-056 · P-a Bước 0: STUB PF1 — luật thuần `!key` ở composer (phân loại, lọc, điền). PF1 hiện thực + test (R-B* của backend là bản gốc).
import type { ProcessCatalogItem } from "@ai/contracts/chat";

/** Một dòng của menu `!` (cùng dạng `AgentMatch`/`CommandMatch`: `{ item }`). */
export type ProcessMatch = { item: ProcessCatalogItem };

/** Kết quả phân loại tin gõ ở composer chính (Hỏi AI): `none` = gửi như chữ thường. */
export type BangClass = { kind: "none" } | { kind: "run"; key: string; input: string };

/** Bước 0: luôn `none` (không chặn tin nào). */
export function classifyBang(_text: string): BangClass {
  return { kind: "none" };
}

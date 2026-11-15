// CR-160 · dữ kiện LÕI: engine đọc từ chính lượt (không từ sự kiện), nên chỉ node Nếu / Ghi giá trị dùng được. «Bắt đầu khi» (điều kiện
// trên dữ kiện LÚC sự kiện) không chọn và không lưu được khoá này. MỘT nguồn cho UI, luật lưu (contracts) và engine (hub-api).
import type { AppFactDecl } from "./manifest";

export const CORE_FACT_KEYS = ["starter_is_top"] as const;
export type CoreFactKey = (typeof CORE_FACT_KEYS)[number];
export const isCoreFact = (key: string): key is CoreFactKey =>
  (CORE_FACT_KEYS as readonly string[]).includes(key);

/** Danh sách dữ kiện cho «Bắt đầu khi»: bỏ khoá lõi. */
export const triggerFactsOf = (facts: readonly AppFactDecl[]): AppFactDecl[] =>
  facts.filter((f) => !isCoreFact(f.key));

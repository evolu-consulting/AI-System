// HUB-FR-10 · mục menu `/` từ catalog (plan-rules). Thuần. B0: chỉ chữ ký (B2).
import type { CommandMenuItem } from "@ai/contracts/chat";
import type { CatalogCommand, CatalogWorkflow } from "./catalog.types";

/** `required` = arg map vào input `required` ∧ `default=null` ∧ `fallback=null`. */
export function toMenuItem(c: CatalogCommand, w: CatalogWorkflow): CommandMenuItem {
  throw new Error(`not implemented: toMenuItem(${c.id}, ${w.id})`);
}

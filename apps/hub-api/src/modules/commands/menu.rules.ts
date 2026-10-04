// HUB-FR-10 · mục menu `/` từ catalog (plan-rules, test-plan R40–R42). Thuần.
// Chỉ trả tên/alias/mô tả/tham số — không lộ workflow, input_map, secret, URL (R41).
import type { CommandArg, LocalizedText } from "@ai/contracts";
import type { CommandMenuArg, CommandMenuItem } from "@ai/contracts/chat";
import type { CatalogCommand, CatalogWorkflow } from "./catalog.types";

const desc = (d: LocalizedText) => ({ vi: d.vi, en: d.en ?? null });

/** Tên input `required` của workflow được map từ tham số `argName`. */
function mapsToRequired(c: CatalogCommand, w: CatalogWorkflow, argName: string): boolean {
  const required = new Set(w.inputSchema.filter((i) => i.required).map((i) => i.name));
  return Object.entries(c.inputMap).some(
    ([input, e]) => e.source === "arg" && e.value === argName && required.has(input),
  );
}

function toMenuArg(c: CatalogCommand, w: CatalogWorkflow, a: CommandArg): CommandMenuArg {
  return {
    name: a.name,
    description: desc(a.description),
    required: a.default === null && a.fallback === null && mapsToRequired(c, w, a.name),
    has_fallback: a.fallback !== null,
    rest: a.rest,
  };
}

/** `required` = arg map vào input `required` ∧ `default=null` ∧ `fallback=null`. */
export function toMenuItem(c: CatalogCommand, w: CatalogWorkflow): CommandMenuItem {
  return {
    name: c.name,
    aliases: [...c.aliases],
    description: desc(c.description),
    args: c.args.map((a) => toMenuArg(c, w, a)),
  };
}

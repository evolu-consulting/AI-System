// V2-B · BA v2 §2 (nhóm SP, cách lấy hàng) · §5.5b (gợi ý: quy tắc nhận diện ⇒ trùng từ ⇒ Tạo mới) · §5.5c (HĐ Giới thiệu chỉ gắn SP
// nhóm Giới thiệu) · §5.5f (thành phần: AI/từ gợi ý thành phần trùng từ — "USB Token trắng" ⇒ USB Token). Thuần.

import { foldVi } from "./fold.rules";
import type {
  ComponentMode,
  ProductCreate,
  ProductGroup,
  ProductMatchOut,
  ProductOut,
} from "./products.types";

/** Cách lấy hàng được phép theo nhóm: Dịch vụ có hạn (gói suất, kho thiết bị kèm, đặt theo khách) · Hàng hoá · Giới thiệu. */
export const MODES_OF: Record<ProductGroup, readonly ComponentMode[]> = {
  service: ["quota", "stock", "order"],
  goods: ["stock", "order"],
  referral: ["none"],
};
const DEFAULT_MODE: Record<ProductGroup, ComponentMode> = {
  service: "quota",
  goods: "stock",
  referral: "none",
};

export type ComponentPlan = { ord: number; name: string; unit: string | null; mode: ComponentMode };
export type RulePlan = { pattern: string; component: number | null };
export type ProductPlan = { components: ComponentPlan[]; rules: RulePlan[] };

/** Thành phần + quy tắc của SP mới, hoặc lý do sai (chuỗi). */
export function productPlan(p: ProductCreate): ProductPlan | string {
  const base = p.no_stock && p.group !== "referral" ? "order" : DEFAULT_MODE[p.group];
  const comps = (p.components ?? [{ name: p.name, unit: p.unit ?? null }]).map((c, ord) => ({
    ord,
    name: c.name,
    unit: c.unit ?? p.unit ?? null,
    mode: "mode" in c && c.mode ? c.mode : base,
  }));
  const bad = comps.find((c) => !MODES_OF[p.group].includes(c.mode));
  if (bad) return `thành phần "${bad.name}": nhóm ${p.group} không dùng cách lấy hàng ${bad.mode}`;
  const names = new Set(comps.map((c) => foldVi(c.name)));
  if (names.size !== comps.length) return "tên thành phần trùng nhau";
  const rules = (p.rules ?? []).map((r) => ({
    pattern: r.pattern,
    component: r.component ?? null,
  }));
  if (rules.some((r) => r.component !== null && r.component >= comps.length))
    return "quy tắc trỏ thành phần không có";
  if (new Set(rules.map((r) => foldVi(r.pattern))).size !== rules.length)
    return "quy tắc trùng nhau";
  return { components: comps, rules };
}

const words = (s: string): string[] => [
  ...new Set(
    foldVi(s)
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length >= 2),
  ),
];

/** Tỷ lệ từ của `name` có mặt trong dòng (0…1). */
export function overlap(line: string, name: string): number {
  const ws = words(name);
  if (ws.length === 0) return 0;
  const have = new Set(words(line));
  return ws.filter((w) => have.has(w)).length / ws.length;
}

/** Thành phần có tên trùng từ nhiều nhất với dòng (SP nhiều thành phần); hoà/không trùng ⇒ null. */
export function pickComponent(line: string, p: ProductOut): string | null {
  if (p.components.length < 2) return p.components[0]?.id ?? null;
  const scored = p.components
    .map((c) => ({ id: c.id, s: overlap(line, c.name) }))
    .sort((a, b) => b.s - a.s);
  const [a, b] = scored;
  return a && a.s > 0 && a.s > (b?.s ?? 0) ? a.id : null;
}

export const MATCH_MIN = 0.5;
export const MATCH_MAX = 5;

/** BA 5.5b: quy tắc nhận diện trước (từ khoá có trong dòng), rồi SP trùng ≥ 50% từ; không có ⇒ đề xuất tạo SP từ tên dòng. */
export function matchLine(
  text: string,
  deal: "buy" | "sell" | "referral" | null | undefined,
  products: readonly ProductOut[],
): ProductMatchOut {
  const line = ` ${foldVi(text)} `;
  const allowed = products.filter(
    (p) => (deal === "referral") === (p.group === "referral") || !deal,
  );
  const out: ProductMatchOut["suggestions"] = [];
  for (const p of allowed) {
    const rule = p.rules.find((r) => line.includes(foldVi(r.pattern)));
    if (rule)
      out.push({
        product: p,
        component_id: rule.component_id ?? pickComponent(text, p),
        by: "rule",
        score: 1,
      });
  }
  const seen = new Set(out.map((s) => s.product.id));
  const byWords = allowed
    .filter((p) => !seen.has(p.id))
    .map((p) => ({
      p,
      s: Math.max(overlap(text, p.name), ...p.components.map((c) => overlap(text, c.name))),
    }))
    .filter((x) => x.s >= MATCH_MIN)
    .sort((a, b) => b.s - a.s || a.p.name.localeCompare(b.p.name));
  for (const x of byWords)
    out.push({
      product: x.p,
      component_id: pickComponent(text, x.p),
      by: "words",
      score: Math.round(x.s * 100) / 100,
    });
  const suggestions = out.slice(0, MATCH_MAX);
  return { suggestions, create: suggestions.length ? null : { name: text.trim().slice(0, 300) } };
}

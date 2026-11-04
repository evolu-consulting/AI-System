// V2-J1 · "Sản phẩm" của trang Sản phẩm & Giá: tab nhóm, sắc thái đề xuất/điểm, chữ "đang nắm giữ" — thuần (không React).
import type { BizProductRow, BizSuggestion, ProductGroup } from "@ai/contracts";
import type { TagTone } from "~/components/shared/tag";

export const CATALOG_TABS = ["all", "service", "goods", "referral"] as const;
export type CatalogTab = (typeof CATALOG_TABS)[number];

/** `g` vắng/lạ ⇒ Tất cả. */
export const catalogTabOf = (v: unknown): CatalogTab => CATALOG_TABS.find((t) => t === v) ?? "all";

export const filterTab = (items: readonly BizProductRow[], tab: CatalogTab): BizProductRow[] =>
  tab === "all" ? [...items] : items.filter((i) => i.group === tab);

export const SUGGEST_TONE: Record<BizSuggestion, TagTone> = {
  buy: "ok",
  push: "ok",
  hold: "grey",
  keep: "grey",
  dump: "late",
  stop: "late",
};

/** Màu thanh điểm theo ngưỡng mặc định (≥ 70 tốt, < 45 yếu). */
export const barTone = (v: number | null): "ok" | "soon" | "late" | "grey" =>
  v === null ? "grey" : v >= 70 ? "ok" : v >= 45 ? "soon" : "late";

/** SL hiển thị: số nguyên có dấu chấm nghìn, lẻ ≤ 4 chữ số. */
export const qtyText = (n: number): string =>
  n.toLocaleString("vi-VN", { maximumFractionDigits: 4 });

export type HeldView =
  | { kind: "none" }
  | { kind: "qty"; text: string }
  | { kind: "quota"; text: string; expiresOn: string | null };

/** Đang nắm giữ: không giữ ⇒ none; gói suất ⇒ kèm hạn sớm nhất; còn lại ⇒ SL + đơn vị. */
export function heldView(p: Pick<BizProductRow, "held" | "kind">): HeldView {
  if (p.held.qty <= 0) return { kind: "none" };
  const text = `${qtyText(p.held.qty)}${p.held.unit ? ` ${p.held.unit}` : ""}`;
  return p.kind === "quota"
    ? { kind: "quota", text, expiresOn: p.held.expires_on }
    : { kind: "qty", text };
}

export const GROUP_TAG: Record<ProductGroup, TagTone> = {
  service: "act",
  goods: "grey",
  referral: "soon",
};

// nav-v2 · "Sản phẩm & Giá": tab của trang và tham số tìm kiếm của route `/products` (thuần, không React).
export const PRODUCT_TABS = ["prices", "cks", "sourcing"] as const;
export type ProductsTab = (typeof PRODUCT_TABS)[number];

/** `tab` vắng/lạ ⇒ "So sánh giá" (tab mặc định, như /prices cũ). */
export const tabOf = (v: unknown): ProductsTab => PRODUCT_TABS.find((t) => t === v) ?? "prices";

export type ProductsSearch = { tab?: ProductsTab; product?: string; filter?: string; lot?: string };

const text = (v: unknown, max: number): string | undefined =>
  typeof v === "string" && v.length > 0 && v.length <= max ? v : undefined;

/** Chuẩn hoá tham số URL: bỏ giá trị rỗng/quá dài; `tab=prices` là mặc định nên không ghi. */
export function parseProductsSearch(s: Record<string, unknown>): ProductsSearch {
  const product = text(s.product, 600);
  const filter = text(s.filter, 200);
  const lot = text(s.lot, 200);
  return {
    ...(s.tab === "cks" || s.tab === "sourcing" ? { tab: s.tab } : {}),
    ...(product ? { product } : {}),
    ...(filter ? { filter } : {}),
    ...(lot ? { lot } : {}),
  };
}

// nav-v2 · Sản phẩm & Giá: tab của trang và tham số tìm kiếm của route `/products` (thuần, không React). V2-J1: thêm tab "Sản phẩm"
// (mặc định) — danh sách điểm kinh doanh; `?g=` nhóm, `?sp=` chi tiết, `?ht=` tab chi tiết.
export const PRODUCT_TABS = ["catalog", "prices", "cks", "sourcing"] as const;
export type ProductsTab = (typeof PRODUCT_TABS)[number];

/** `tab` vắng/lạ ⇒ "Sản phẩm" (tab mặc định). */
export const tabOf = (v: unknown): ProductsTab => PRODUCT_TABS.find((t) => t === v) ?? "catalog";

export type ProductsSearch = {
  tab?: Exclude<ProductsTab, "catalog">;
  product?: string;
  filter?: string;
  lot?: string;
  g?: "service" | "goods" | "referral";
  sp?: string;
  ht?: string;
};

const text = (v: unknown, max: number): string | undefined =>
  typeof v === "string" && v.length > 0 && v.length <= max ? v : undefined;

/** Chuẩn hoá tham số URL: bỏ giá trị rỗng/quá dài; `tab=catalog` là mặc định nên không ghi. */
export function parseProductsSearch(s: Record<string, unknown>): ProductsSearch {
  const product = text(s.product, 600);
  const filter = text(s.filter, 200);
  const lot = text(s.lot, 200);
  const sp = text(s.sp, 64);
  const ht = text(s.ht, 40);
  return {
    ...(s.tab === "prices" || s.tab === "cks" || s.tab === "sourcing" ? { tab: s.tab } : {}),
    ...(product ? { product } : {}),
    ...(filter ? { filter } : {}),
    ...(lot ? { lot } : {}),
    ...(s.g === "service" || s.g === "goods" || s.g === "referral" ? { g: s.g } : {}),
    ...(sp ? { sp } : {}),
    ...(sp && ht ? { ht } : {}),
  };
}

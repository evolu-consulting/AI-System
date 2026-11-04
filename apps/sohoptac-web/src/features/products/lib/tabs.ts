// nav-v2 + V2-J1 + V2-O · Sản phẩm & Giá: tham số URL của /products. Chỉ còn MỘT trang (danh sách SP, `?g=` nhóm; chi tiết `?sp=` kèm `?ht=`
// tab chi tiết); các tab cũ (So sánh giá, Sản phẩm CKS, Mua hàng) đã gộp vào chi tiết SP / Hợp đồng — tham số `tab` cũ bị bỏ.
export type ProductsSearch = {
  g?: "service" | "goods" | "referral";
  sp?: string;
  ht?: string;
};

const text = (v: unknown, max: number): string | undefined =>
  typeof v === "string" && v.length > 0 && v.length <= max ? v : undefined;

/** Chuẩn hoá tham số URL: bỏ giá trị rỗng/quá dài/lạ (kể cả `tab`, `product`, `filter`, `lot` của link cũ). */
export function parseProductsSearch(s: Record<string, unknown>): ProductsSearch {
  const sp = text(s.sp, 64);
  const ht = text(s.ht, 40);
  return {
    ...(s.g === "service" || s.g === "goods" || s.g === "referral" ? { g: s.g } : {}),
    ...(sp ? { sp } : {}),
    ...(sp && ht ? { ht } : {}),
  };
}

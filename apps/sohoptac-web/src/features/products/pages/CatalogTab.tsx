// V2-J1 · tab "Sản phẩm" của /products: `?sp=<id>` ⇒ chi tiết (`?ht=` chọn tab), còn lại ⇒ danh sách (`?g=` chọn nhóm).
import { useSearch } from "@tanstack/react-router";
import { ProductDetail } from "../components/ProductDetail";
import { ProductList } from "../components/ProductList";
import { catalogTabOf } from "../lib/business";

export function CatalogTab() {
  const s = useSearch({ strict: false }) as { sp?: string; g?: unknown; ht?: string };
  return s.sp ? <ProductDetail id={s.sp} ht={s.ht} /> : <ProductList tab={catalogTabOf(s.g)} />;
}

// nav-v2: /products — "Sản phẩm & Giá": Sản phẩm (`catalog`, mặc định, V2-J1: điểm kinh doanh; `?g=`/`?sp=`/`?ht=`) · So sánh giá (`prices`, `?product=` chọn mặt hàng) · Sản phẩm CKS (`cks`, `?filter=`/`?lot=`)
// · Mua hàng (`sourcing`) trong một trang có tab. Tuyến cũ /prices /cks /sourcing chuyển hướng vào đây.
import { createFileRoute } from "@tanstack/react-router";
import { parseProductsSearch } from "~/features/products/lib/tabs";
import { ProductsPage } from "~/features/products/pages/ProductsPage";

export const Route = createFileRoute("/_authed/products")({
  validateSearch: parseProductsSearch,
  component: ProductsPage,
});

// nav-v2 + V2-O: /products — "Sản phẩm & Giá": danh sách SP (?g=) → chi tiết (?sp=/?ht=). Tuyến cũ /prices /cks /sourcing chuyển hướng vào đây.
import { createFileRoute } from "@tanstack/react-router";
import { parseProductsSearch } from "~/features/products/lib/tabs";
import { ProductsPage } from "~/features/products/pages/ProductsPage";

export const Route = createFileRoute("/_authed/products")({
  validateSearch: parseProductsSearch,
  component: ProductsPage,
});

// nav-v2: /prices → tab "So sánh giá" của /products (giữ `?product=` mặt hàng).
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authed/prices")({
  validateSearch: (s: Record<string, unknown>): { product?: string } =>
    typeof s.product === "string" && s.product.length <= 600 ? { product: s.product } : {},
  beforeLoad: ({ search }) => {
    throw redirect({
      to: "/products",
      // `tab` vắng = "So sánh giá" (mặc định) nên không ghi vào URL.
      search: search.product ? { product: search.product } : {},
      replace: true,
    });
  },
});

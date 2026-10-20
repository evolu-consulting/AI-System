// nav-v2: /prices → tab "So sánh giá" của /products (giữ `?product=` mặt hàng).
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authed/prices")({
  validateSearch: (s: Record<string, unknown>): { product?: string } =>
    typeof s.product === "string" && s.product.length <= 600 ? { product: s.product } : {},
  beforeLoad: ({ search }) => {
    throw redirect({
      to: "/products",
      // V2-J1: tab mặc định của /products là "Sản phẩm" ⇒ ghi `tab=prices` rõ ràng.
      search: search.product ? { tab: "prices", product: search.product } : { tab: "prices" },
      replace: true,
    });
  },
});

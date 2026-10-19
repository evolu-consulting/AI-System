// PK-FR-10 · HD-FR-97 · HD8-FR-05 · /prices — mặc định "Chữ ký số" (D9-13, HD9); `?product=` chọn mặt hàng hoá để so giá NCC (HD8).
import { createFileRoute } from "@tanstack/react-router";
import { PricesRoutePage } from "~/features/goods-prices/pages/PricesRoutePage";

export const Route = createFileRoute("/_authed/prices")({
  validateSearch: (s: Record<string, unknown>): { product?: string } =>
    typeof s.product === "string" && s.product.length <= 600 ? { product: s.product } : {},
  component: PricesRoutePage,
});

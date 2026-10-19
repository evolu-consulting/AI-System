// PK-FR-10 · HD-FR-97 · S08: /prices — mặc định "Chữ ký số" (D9-13); hàng hoá + bảng rẻ nhất ở HD8.
import { createFileRoute } from "@tanstack/react-router";
import { PricesPage } from "~/features/cks-prices/pages/PricesPage";

export const Route = createFileRoute("/_authed/prices")({ component: PricesPage });

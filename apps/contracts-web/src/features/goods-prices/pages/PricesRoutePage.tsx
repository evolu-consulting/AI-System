// HD8-FR-05 · S08/S-p03 `/prices` — port `mgmt-app/web/src/pages/prices/PricesPage.tsx:27-45`: ô "Mặt hàng" (Chữ ký số đứng đầu,
// mặc định; rồi hàng hoá mình mua), chọn theo `?product=`; Chữ ký số ⇒ bảng CKS của HD9, hàng hoá ⇒ so giá NCC.
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { PricesPage } from "~/features/cks-prices/pages/PricesPage";
import { fetchProducts, partnerKeys } from "~/features/partners/api";
import { GoodsTab } from "../components/GoodsTab";

export function PricesRoutePage() {
  const { t } = useTranslation();
  const search = useSearch({ strict: false }) as { product?: unknown };
  const navigate = useNavigate();
  const products = useQuery({
    queryKey: partnerKeys.products,
    queryFn: ({ signal }) => fetchProducts(signal),
  });
  const product = typeof search.product === "string" && search.product ? search.product : "cks";
  const picker = (
    <select
      aria-label={t("contracts.cks.prices.product")}
      value={product}
      onChange={(e) =>
        void navigate({
          to: "/prices",
          search: e.target.value === "cks" ? {} : { product: e.target.value },
        })
      }
      className="field h-9 w-auto py-0 text-[15px] font-medium"
    >
      <option value="cks">{t("contracts.cks.product")}</option>
      {(products.data ?? []).map((p) => (
        <option key={p.key} value={p.key}>
          {p.label}
        </option>
      ))}
    </select>
  );
  return product === "cks" ? (
    <PricesPage productPicker={picker} />
  ) : (
    <GoodsTab picker={picker} product={product} />
  );
}

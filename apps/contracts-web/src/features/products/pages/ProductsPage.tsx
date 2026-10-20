// nav-v2 · /products "Sản phẩm & Giá": một trang, ba tab (So sánh giá · Sản phẩm CKS · Mua hàng) thay cho ba mục menu cũ /prices /cks /sourcing.
// Mỗi tab là trang cũ nguyên vẹn (cùng API, cùng quyền); tiêu đề con không còn là H1 (`EmbeddedHeads`). Tab nằm trong URL `?tab=`.
import { Link, useSearch } from "@tanstack/react-router";
import type { ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { EmbeddedHeads, PageHead } from "~/components/shared/layout";
import { CksPage } from "~/features/cks/pages/CksPage";
import { PricesRoutePage } from "~/features/goods-prices/pages/PricesRoutePage";
import { SourcingPage } from "~/features/sourcing/pages/SourcingPage";
import { PRODUCT_TABS, type ProductsTab, tabOf } from "../lib/tabs";

const BODY: Record<ProductsTab, () => ReactElement> = {
  prices: PricesRoutePage,
  cks: CksPage,
  sourcing: SourcingPage,
};

export function ProductsPage() {
  const { t } = useTranslation();
  const search = useSearch({ strict: false }) as { tab?: unknown };
  const tab = tabOf(search.tab);
  const Body = BODY[tab];
  return (
    <div className="text-base leading-[1.55] md:flex md:min-h-0 md:flex-1 md:flex-col">
      <PageHead title={t("contracts.productsPage.title")} />
      <div
        role="tablist"
        aria-label={t("contracts.productsPage.tabs")}
        className="mb-4 flex gap-1 overflow-x-auto border-b border-rule"
      >
        {PRODUCT_TABS.map((k) => (
          <Link
            key={k}
            to="/products"
            search={k === "prices" ? {} : { tab: k }}
            role="tab"
            id={`products-tab-${k}`}
            aria-selected={tab === k}
            aria-controls="products-panel"
            className="-mb-px border-b-2 border-transparent px-3.5 py-2.5 text-body whitespace-nowrap text-ink-2 hover:text-ink aria-selected:border-act aria-selected:font-semibold aria-selected:text-act"
          >
            {t(`contracts.productsPage.${k}`)}
          </Link>
        ))}
      </div>
      <div
        role="tabpanel"
        id="products-panel"
        aria-labelledby={`products-tab-${tab}`}
        className="md:flex md:min-h-0 md:flex-1 md:flex-col md:overflow-y-auto"
      >
        <EmbeddedHeads.Provider value={true}>
          <Body />
        </EmbeddedHeads.Provider>
      </div>
    </div>
  );
}

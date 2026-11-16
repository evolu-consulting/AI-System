// nav-v2 + V2-O · /products "Sản phẩm & Giá": một trang — danh sách SP (điểm kinh doanh) → chi tiết SP (hợp đồng, lịch sử, khách đang dùng, NCC & giá).
// Các tab cũ So sánh giá / Sản phẩm CKS / Mua hàng đã gộp vào chi tiết SP và Hợp đồng; tuyến cũ chuyển hướng vào đây.
import { Button } from "@ai/web-kit/ui/kit/button";
import { PageHeader } from "@ai/web-kit/ui/kit/page-header";
import { useSearch } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { EmbeddedHeads } from "~/components/shared/layout";
import { useMe } from "~/features/pack-state/hooks/use-me";
import { AddProductDialog } from "../components/AddProductDialog";
import { CatalogTab } from "./CatalogTab";

/** CR-180 · «Thêm sản phẩm» là nút chính của đầu trang (chỉ ở danh sách, không ở chi tiết). */
function ProductsHeader() {
  const { t } = useTranslation();
  const { write } = useMe();
  const sp = (useSearch({ strict: false }) as { sp?: string }).sp;
  const [addOpen, setAddOpen] = useState(false);
  return (
    <>
      <PageHeader
        className="mb-5"
        title={t("contracts.productsPage.title")}
        primary={
          write && !sp ? (
            <Button
              variant="primary"
              data-testid="gd1-add-product"
              onClick={() => setAddOpen(true)}
            >
              {t("contracts.gapd1.add.open")}
            </Button>
          ) : undefined
        }
      />
      <AddProductDialog open={addOpen} onOpenChange={setAddOpen} />
    </>
  );
}

export function ProductsPage() {
  return (
    <div className="text-base leading-[1.55] md:flex md:min-h-0 md:flex-1 md:flex-col">
      <ProductsHeader />
      <div className="md:flex md:min-h-0 md:flex-1 md:flex-col md:overflow-y-auto">
        <EmbeddedHeads.Provider value={true}>
          <CatalogTab />
        </EmbeddedHeads.Provider>
      </div>
    </div>
  );
}

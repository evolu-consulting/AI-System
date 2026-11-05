// nav-v2 + V2-O · /products "Sản phẩm & Giá": một trang — danh sách SP (điểm kinh doanh) → chi tiết SP (hợp đồng, lịch sử, khách đang dùng, NCC & giá).
// Các tab cũ So sánh giá / Sản phẩm CKS / Mua hàng đã gộp vào chi tiết SP và Hợp đồng; tuyến cũ chuyển hướng vào đây.
import { useTranslation } from "react-i18next";
import { EmbeddedHeads, PageHead } from "~/components/shared/layout";
import { CatalogTab } from "./CatalogTab";

export function ProductsPage() {
  const { t } = useTranslation();
  return (
    <div className="text-base leading-[1.55] md:flex md:min-h-0 md:flex-1 md:flex-col">
      <PageHead title={t("contracts.productsPage.title")} />
      <div className="md:flex md:min-h-0 md:flex-1 md:flex-col md:overflow-y-auto">
        <EmbeddedHeads.Provider value={true}>
          <CatalogTab />
        </EmbeddedHeads.Provider>
      </div>
    </div>
  );
}

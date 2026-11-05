// V2-G · BA 5.5/§4.2: khối "Sản phẩm" ở bước xác nhận sau AI đọc — dòng hàng AI đọc sửa được tại chỗ (không xoá dòng đã lưu), mỗi dòng có chọn
// SP danh mục với gợi ý sẵn (quy tắc nhận diện → trùng từ → "Tạo sản phẩm mới" + thành phần).
import type { ContractDeal, ProductOut } from "@ai/contracts";
import { useTranslation } from "react-i18next";
import { Panel } from "~/components/shared/layout";
import { Tag } from "~/components/shared/tag";
import { ItemTable } from "~/features/contract-form/components/ItemTable";
import { STOCK_EFFECT } from "~/features/contract-form/lib/deal";
import type { LineState } from "~/features/contract-form/lib/form-model";
import { stockTone } from "~/features/contract-form/lib/stock-label";

export function ReviewItemsPanel(p: {
  items: readonly LineState[];
  deal: ContractDeal;
  products: readonly ProductOut[];
  unlinked: ReadonlySet<number>;
  onPatch: (i: number, l: Partial<LineState>) => void;
  onAdd: () => void;
  onRemove: (i: number) => void;
}) {
  const { t } = useTranslation();
  const effect = STOCK_EFFECT[p.deal];
  return (
    <Panel>
      <div className="flex flex-wrap items-center gap-3 border-b border-rule-soft px-5 py-3.5">
        <h2 className="text-[15px] font-semibold">{t("contracts.cdetail.reviewItems")}</h2>
        <Tag tone={stockTone(effect)}>{t(`contracts.cform.stock.${effect}`)}</Tag>
      </div>
      <div data-testid="review-items">
        <ItemTable
          items={p.items}
          deal={p.deal}
          products={p.products}
          unlinked={p.unlinked}
          onPatch={p.onPatch}
          onAdd={p.onAdd}
          onRemove={p.onRemove}
        />
      </div>
    </Panel>
  );
}

// V2-J2 · tab "Nhà cung cấp & giá" của chi tiết sản phẩm (BA v2 §3.3 SP-04/05/06). CỔNG TAB cho trang chi tiết (V2-J1): gắn
// `<SupplierPricesTab productId={id} />` vào slot tab "Nhà cung cấp & giá" khi `supplierTabVisible(group)`; SP Giới thiệu ⇒ không hiện
// (component tự trả null khi máy chủ báo nhóm Giới thiệu). Chưa có trang chi tiết ⇒ route tối thiểu `/products/$productId/suppliers`.
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { Empty, ErrorLine, Loading } from "~/components/shared/states";
import { useMe } from "~/features/pack-state/hooks/use-me";
import { useDeleteSupplierPrice, useSupplierOverview } from "../hooks/use-suppliers";
import { supplierTabVisible } from "../lib/suppliers";
import { ComparePanel } from "./ComparePanel";
import { EvalPanel } from "./EvalPanel";
import { ManualPriceDialog } from "./ManualPriceDialog";
import { PricingPanel } from "./PricingPanel";
import { QuoteDialog } from "./QuoteDialog";
import { ScoutConfigPanel } from "./ScoutConfigPanel";
import { SearchDialog } from "./SearchDialog";

export function SupplierPricesTab({ productId }: { productId: string }) {
  const { t } = useTranslation();
  const { write } = useMe();
  const dlg = useRef<HTMLDialogElement>(null);
  const manualDlg = useRef<HTMLDialogElement>(null);
  const quoteDlg = useRef<HTMLDialogElement>(null);
  const q = useSupplierOverview(productId);
  const del = useDeleteSupplierPrice(productId);
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorLine error={q.error} />;
  const data = q.data;
  if (!data) return <Empty title={t("contracts.psup.empty")} />;
  if (!supplierTabVisible(data.product.group)) return null;
  return (
    <div className="flex flex-col gap-4 text-base leading-[1.55]">
      <ComparePanel
        data={data}
        write={write}
        onSearch={() => dlg.current?.showModal()}
        onManual={() => manualDlg.current?.showModal()}
        onQuote={() => quoteDlg.current?.showModal()}
        onDelete={(id) => del.mutate(id)}
      />
      <PricingPanel pricing={data.pricing} />
      <EvalPanel suppliers={data.suppliers} />
      <ScoutConfigPanel productId={productId} write={write} />
      <SearchDialog dlg={dlg} productId={productId} productName={data.product.name} />
      <ManualPriceDialog dlg={manualDlg} productId={productId} />
      <QuoteDialog dlg={quoteDlg} productId={productId} productName={data.product.name} />
    </div>
  );
}

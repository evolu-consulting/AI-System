// HD-FR-26 · S04 · Q15 · V2-F (HD-01 · 5.5a · 5.7e · mockup NITI "Thêm hợp đồng"): nhập tay hợp đồng — thanh Hủy/Lưu dính ở đầu, 3 ô
// chọn loại Mua/Bán/Giới thiệu (nhãn đối tác + kho đi theo loại), ô bắt buộc viền đỏ, đối tác kèm điểm uy tín / "Đối tác mới", bảng
// dòng hàng gắn SP danh mục. Lưu ⇒ `POST /pack/contracts/contracts/manual` ⇒ mở HĐ mới.
import { Link } from "@tanstack/react-router";
import type { FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Panel } from "~/components/shared/layout";
import { Tag } from "~/components/shared/tag";
import { DealTiles } from "~/features/contract-form/components/DealTiles";
import { FieldsGrid } from "~/features/contract-form/components/FieldsGrid";
import { FormBar } from "~/features/contract-form/components/FormBar";
import { ItemTable } from "~/features/contract-form/components/ItemTable";
import { useContractForm } from "~/features/contract-form/hooks/use-contract-form";
import { STOCK_EFFECT } from "~/features/contract-form/lib/deal";
import { stockTone } from "~/features/contract-form/lib/stock-label";

export function NewContractPage() {
  const { t } = useTranslation();
  const form = useContractForm();
  const { f } = form;
  const effect = STOCK_EFFECT[f.deal];
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void form.submit();
  };
  return (
    <form onSubmit={onSubmit} noValidate className="text-base leading-[1.55]">
      <FormBar
        crumb={
          <Link to="/contracts" className="hover:underline">
            {t("contracts.review.back")}
          </Link>
        }
        title={t("contracts.cform.newTitle")}
        cancel={
          <Link to="/contracts" className="btn btn-quiet">
            {t("contracts.common.cancel")}
          </Link>
        }
        save={
          <button type="submit" className="btn btn-primary" disabled={form.busy}>
            {form.busy ? t("contracts.cform.saving") : t("contracts.cform.save")}
          </button>
        }
      />
      {form.err && (
        <p role="alert" className="mb-3 text-sm text-late">
          {form.err}
        </p>
      )}
      <div className="flex flex-col gap-4">
        <Panel>
          <div className="border-b border-rule-soft px-5 py-3.5">
            <h2 className="text-[15px] font-semibold">{t("contracts.cform.infoTitle")}</h2>
          </div>
          <div className="flex flex-col gap-4 px-5 py-4">
            <DealTiles value={f.deal} onChange={form.setDeal} />
            <FieldsGrid f={f} onSet={form.set} invalid={form.invalid} cols={3} />
          </div>
        </Panel>
        <Panel>
          <div className="flex items-center gap-3 border-b border-rule-soft px-5 py-3.5">
            <h2 className="text-[15px] font-semibold">{t("contracts.cform.itemsTitle")}</h2>
            <Tag tone={stockTone(effect)}>{t(`contracts.cform.stock.${effect}`)}</Tag>
          </div>
          <ItemTable
            items={f.items}
            deal={f.deal}
            products={form.products}
            unlinked={form.unlinked}
            onPatch={form.patchLine}
            onAdd={form.addLine}
            onRemove={form.removeLine}
          />
        </Panel>
      </div>
    </form>
  );
}

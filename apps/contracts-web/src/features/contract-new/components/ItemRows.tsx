// HD-FR-26 · S04 · D-02: khối "Hàng hoá / dịch vụ" — port `NewContractPage.tsx:101-112`. Chỉ trình bày.
import { useTranslation } from "react-i18next";
import { EMPTY_ITEM, type ItemRow } from "../lib/new-form";

export function ItemRows({
  items,
  onChange,
}: {
  items: ItemRow[];
  onChange: (items: ItemRow[]) => void;
}) {
  const { t } = useTranslation();
  const set = (i: number, k: keyof ItemRow, v: string) =>
    onChange(items.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-[13px] font-semibold">{t("contracts.newContract.items")}</legend>
      {items.map((it, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: dòng nhập tay chưa có id (như mgmt-app)
        <div key={i} className="grid grid-cols-[2fr_1fr_1fr_1.3fr_auto] gap-2 max-sm:grid-cols-2">
          <input
            aria-label={t("contracts.newContract.itemName")}
            placeholder={t("contracts.newContract.itemName")}
            value={it.name}
            onChange={(e) => set(i, "name", e.target.value)}
            className="field"
          />
          <input
            aria-label={t("contracts.newContract.itemUnit")}
            placeholder={t("contracts.newContract.itemUnit")}
            value={it.unit}
            onChange={(e) => set(i, "unit", e.target.value)}
            className="field"
          />
          <input
            aria-label={t("contracts.newContract.itemQty")}
            placeholder={t("contracts.newContract.itemQtyShort")}
            value={it.qty}
            onChange={(e) => set(i, "qty", e.target.value)}
            className="field font-mono"
            inputMode="decimal"
          />
          <input
            aria-label={t("contracts.newContract.itemPrice")}
            placeholder={t("contracts.newContract.itemPricePlaceholder")}
            value={it.unit_price}
            onChange={(e) => set(i, "unit_price", e.target.value)}
            className="field font-mono"
            inputMode="numeric"
          />
          <button
            type="button"
            aria-label={t("contracts.newContract.removeRow")}
            className="text-dim hover:text-late"
            onClick={() => onChange(items.filter((_, j) => j !== i))}
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        className="chip chip-dashed self-start"
        onClick={() => onChange([...items, { ...EMPTY_ITEM }])}
      >
        {t("contracts.newContract.addRow")}
      </button>
    </fieldset>
  );
}

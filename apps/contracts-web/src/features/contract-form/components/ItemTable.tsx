// V2-F · HD-01 · 5.5a · mockup `itemsEditor` (bản 2 hàng): bảng dòng hàng — tên trên HĐ, SL, đơn vị, đơn giá, thành tiền; dưới mỗi dòng
// là chọn SP danh mục (`ProductPicker`). Gõ xong tên mà chưa chọn SP ⇒ gợi ý qua `POST /products/match` (V2-B).
import type { ContractDeal, ProductOut } from "@ai/contracts";
import { useTranslation } from "react-i18next";
import { vnd } from "~/components/shared/format";
import { matchProduct } from "../api";
import { autoTotal, type LineState, lineTotal } from "../lib/form-model";
import { suggestionPatch } from "../lib/suggest";
import { ProductPicker } from "./ProductPicker";

type Props = {
  items: readonly LineState[];
  deal: ContractDeal;
  products: readonly ProductOut[];
  unlinked: ReadonlySet<number>;
  onPatch: (i: number, p: Partial<LineState>) => void;
  onAdd: () => void;
  onRemove: (i: number) => void;
};

const INPUT = "field h-9";
const CELL = "px-2 pt-2 pb-1";

function ItemRow({
  line,
  index,
  last,
  deal,
  products,
  invalid,
  onPatch,
  onRemove,
}: {
  line: LineState;
  index: number;
  last: boolean;
  deal: ContractDeal;
  products: readonly ProductOut[];
  invalid: boolean;
  onPatch: (p: Partial<LineState>) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const L = (k: string) => t(`contracts.cform.${k}`);
  const total = lineTotal(line);

  /** Chưa chọn SP ⇒ xin gợi ý; kết quả đến muộn mà người dùng đã chọn tay thì cha giữ lựa chọn tay (`patchLine`). */
  async function suggest() {
    const text = line.name.trim();
    if (text.length < 2 || line.product_id) return;
    try {
      const patch = suggestionPatch(await matchProduct(text, deal), deal);
      if (patch) onPatch(patch);
    } catch {
      /* gợi ý là phụ: lỗi mạng ⇒ người dùng tự chọn */
    }
  }

  return (
    <>
      <tr>
        <td className={`${CELL} first:pl-5`}>
          <input
            aria-label={L("itemNameAria")}
            placeholder={L("itemNamePh")}
            value={line.name}
            onChange={(e) => onPatch({ name: e.target.value })}
            onBlur={() => void suggest()}
            className={`${INPUT} min-w-[150px]`}
          />
        </td>
        <td className={CELL}>
          <input
            aria-label={L("itemQtyAria")}
            inputMode="decimal"
            value={line.qty}
            onChange={(e) => onPatch({ qty: e.target.value })}
            className={`${INPUT} min-w-[64px] text-right font-mono`}
          />
        </td>
        <td className={CELL}>
          <input
            aria-label={L("itemUnitAria")}
            placeholder={L("itemUnitPh")}
            value={line.unit}
            onChange={(e) => onPatch({ unit: e.target.value })}
            className={`${INPUT} w-[90px]`}
          />
        </td>
        <td className={CELL}>
          <input
            aria-label={L("itemPriceAria")}
            inputMode="numeric"
            value={line.unit_price}
            onChange={(e) => onPatch({ unit_price: e.target.value })}
            className={`${INPUT} min-w-[104px] text-right font-mono`}
          />
        </td>
        <td className={`${CELL} text-right font-mono whitespace-nowrap`}>
          {total === null ? <span className="text-dim">—</span> : vnd(total)}
        </td>
        <td className={`${CELL} text-right`}>
          <button
            type="button"
            aria-label={L("removeRow")}
            disabled={last}
            className="px-2 text-dim hover:text-late disabled:opacity-40"
            onClick={onRemove}
          >
            ×
          </button>
        </td>
      </tr>
      <tr>
        <td colSpan={6} className="px-2 pb-3 pl-5">
          <ProductPicker
            line={line}
            index={index}
            deal={deal}
            products={products}
            invalid={invalid}
            onPatch={onPatch}
          />
        </td>
      </tr>
    </>
  );
}

export function ItemTable({ items, deal, products, unlinked, onPatch, onAdd, onRemove }: Props) {
  const { t } = useTranslation();
  const L = (k: string) => t(`contracts.cform.${k}`);
  const total = autoTotal(items);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <colgroup>
          <col />
          <col style={{ width: 110 }} />
          <col style={{ width: 110 }} />
          <col style={{ width: 150 }} />
          <col style={{ width: 140 }} />
          <col style={{ width: 48 }} />
        </colgroup>
        <thead className="bg-sunk text-left text-xs text-dim">
          <tr>
            <th className="px-2 py-2.5 first:pl-5">{L("itemName")}</th>
            <th className="px-2 text-right">{L("itemQty")}</th>
            <th className="px-2">{L("itemUnit")}</th>
            <th className="px-2 text-right">{L("itemPrice")}</th>
            <th className="px-2 text-right">{L("itemTotal")}</th>
            <th className="w-12" />
          </tr>
        </thead>
        <tbody>
          {items.map((l, i) => (
            <ItemRow
              // biome-ignore lint/suspicious/noArrayIndexKey: dòng nhập tay chưa có id
              key={i}
              line={l}
              index={i}
              last={items.length < 2 || !!l.id}
              deal={deal}
              products={products}
              invalid={unlinked.has(i)}
              onPatch={(p) => onPatch(i, p)}
              onRemove={() => onRemove(i)}
            />
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-rule">
            <td colSpan={2} className="px-2 py-3 pl-5">
              <button type="button" className="chip chip-dashed" onClick={onAdd}>
                {L("addRow")}
              </button>
            </td>
            <td colSpan={2} className="px-2 text-right text-[13px] text-dim">
              {L("sumLabel")}
            </td>
            <td className="px-2 text-right font-mono font-semibold" data-testid="items-total">
              {total === null ? "—" : vnd(total)}
            </td>
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

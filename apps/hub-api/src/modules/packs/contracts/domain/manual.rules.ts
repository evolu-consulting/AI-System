// HD-FR-26 · Q15 · D2-04: HĐ nhập tay không file (port `R/api/app/contracts/manual.py:16-24`): mọi trường người gõ là
// `{value, quote:"", verified:true, edited:true}`; đối tác vào bên bán khi mình MUA vào, vào bên mua khi mình BÁN ra. Thuần.
import {
  type ContractFieldKey,
  type ContractFields,
  type FieldValue,
  fillFields,
} from "./fields.rules";
import { type Deal, directionOfDeal } from "./milestones.rules";

export type ManualInput = {
  /** V2-A: một trong hai (zod bắt buộc ≥ 1 và khớp nhau); xem `dealAndDirection`. */
  direction?: "purchase" | "sale" | undefined;
  deal?: Deal | undefined;
  commission_pct?: number | null | undefined;
  commission_fixed?: number | null | undefined;
  number?: string | null;
  title: string;
  partner_name: string;
  partner_tax_id?: string | null;
  partner_signer?: string | null;
  our_signer?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  notice_days?: number | null;
  total_value?: number | null;
  payment_terms?: string | null;
  items: readonly ManualItemInput[];
};
export type ManualItemInput = {
  name: string;
  unit?: string | null;
  qty?: number | null;
  unit_price?: number | null;
};
export type ManualItem = {
  ord: number;
  name: string;
  unit: string | null;
  qty: number | null;
  unit_price: number | null;
};

const blank = (v: string | null | undefined): string | null => {
  const t = (v ?? "").trim();
  return t === "" ? null : t;
};

/** V2-A: loại HĐ + hướng cũ từ đầu vào (zod đã bảo đảm có ít nhất một và khớp nhau). */
export function dealAndDirection(i: Pick<ManualInput, "deal" | "direction">): {
  deal: Deal;
  direction: "purchase" | "sale";
} {
  const deal = i.deal ?? (i.direction === "purchase" ? "buy" : "sell");
  return { deal, direction: i.direction ?? directionOfDeal(deal) };
}

/** Trường của HĐ nhập tay; giá trị rỗng ⇒ trường rỗng (không `edited`). Giới thiệu: đối tác (bên trả HH) ở phía bên mua. */
export function manualFields(i: ManualInput): ContractFields {
  const buying = dealAndDirection(i).direction === "purchase";
  const typed: Partial<Record<ContractFieldKey, FieldValue>> = {
    number: blank(i.number),
    title: blank(i.title),
    [buying ? "supplier_name" : "buyer_name"]: blank(i.partner_name),
    [buying ? "supplier_tax_id" : "buyer_tax_id"]: blank(i.partner_tax_id),
    [buying ? "supplier_representative" : "buyer_representative"]: blank(i.partner_signer),
    [buying ? "buyer_representative" : "supplier_representative"]: blank(i.our_signer),
    start_date: i.start_date ?? null,
    end_date: i.end_date ?? null,
    notice_days: i.notice_days ?? null,
    total_value: i.total_value ?? null,
    payment_terms: blank(i.payment_terms),
  };
  const out = fillFields({});
  for (const [k, v] of Object.entries(typed) as [ContractFieldKey, FieldValue | undefined][]) {
    if (v !== null && v !== undefined)
      out[k] = { value: v, quote: "", verified: true, edited: true };
  }
  return out;
}

/** Dòng hàng có tên (bỏ dòng trống), thứ tự giữ nguyên. */
export function manualItems(items: readonly ManualItemInput[]): ManualItem[] {
  return items
    .filter((it) => it.name.trim() !== "")
    .map((it, ord) => ({
      ord,
      name: it.name.trim(),
      unit: blank(it.unit),
      qty: it.qty ?? null,
      unit_price: it.unit_price ?? null,
    }));
}

/** Bên đối tác (để tra MST): mua vào ⇒ bên bán. */
export const partnerSide = (d: ManualInput["direction"]): "supplier" | "buyer" =>
  d === "purchase" ? "supplier" : "buyer";

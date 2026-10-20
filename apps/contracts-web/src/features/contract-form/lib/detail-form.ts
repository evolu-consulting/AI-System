// V2-F · HD-09 · BA 5.5/C12: form của HĐ ĐÃ LƯU (xác nhận sau upload / sửa ở trang chi tiết) ↔ trường `fields` của HĐ + PATCH.
// Đối tác nằm ở bên bán khi Mua, bên mua khi Bán/Giới thiệu (V2-A); người ký theo phía tương ứng. Loại HĐ và hoa hồng không PATCH được
// (DB khoá `deal`; hoa hồng sửa sau lưu là việc sau) ⇒ khoá ô. Dòng SP khoá sau lưu (C12). Thuần.
import type { ContractDeal, ContractDetail, ContractFieldKey } from "@ai/contracts";
import type { FieldBadge } from "../components/FieldsGrid";
import { dealOf, partnerIsSupplier } from "./deal";
import { EMPTY_FORM, type FormState, type TextKey } from "./form-model";

type FieldKind = "text" | "int";
const asText = (v: unknown): string => (v === null || v === undefined ? "" : String(v));

/** Khoá trường của từng ô form theo loại. */
export function fieldKeyOf(deal: ContractDeal, k: TextKey): ContractFieldKey | null {
  const sup = partnerIsSupplier(deal);
  switch (k) {
    case "title":
    case "number":
    case "start_date":
    case "end_date":
    case "notice_days":
    case "total_value":
    case "payment_terms":
      return k;
    case "partner_name":
      return sup ? "supplier_name" : "buyer_name";
    case "partner_tax_id":
      return sup ? "supplier_tax_id" : "buyer_tax_id";
    case "partner_signer":
      return sup ? "supplier_representative" : "buyer_representative";
    case "our_signer":
      return sup ? "buyer_representative" : "supplier_representative";
    default:
      return null; // hoa hồng: không nằm trong `fields`
  }
}
const KIND: Partial<Record<TextKey, FieldKind>> = { notice_days: "int", total_value: "int" };
const EDITABLE: readonly TextKey[] = [
  "title",
  "number",
  "partner_name",
  "partner_tax_id",
  "partner_signer",
  "our_signer",
  "start_date",
  "end_date",
  "notice_days",
  "total_value",
  "payment_terms",
];
export const LOCKED_AFTER_SAVE: ReadonlySet<TextKey> = new Set<TextKey>([
  "commission_pct",
  "commission_fixed",
]);

type Detail = Pick<
  ContractDetail,
  "deal" | "direction" | "fields" | "commission_pct" | "commission_fixed"
>;

export function formOfDetail(c: Detail): FormState {
  const deal = dealOf(c);
  const f: FormState = { ...EMPTY_FORM, deal, notice_days: "", items: [] };
  for (const k of EDITABLE) {
    const fk = fieldKeyOf(deal, k);
    if (fk) f[k] = asText(c.fields[fk]?.value);
  }
  f.commission_pct = asText(c.commission_pct);
  f.commission_fixed = asText(c.commission_fixed);
  return f;
}

/** Ô đã đổi so với giá trị đã lưu → thân PATCH (null khi xoá trắng; số bỏ ký tự không phải số). */
export function patchOfForm(
  c: Detail,
  f: FormState,
): Partial<Record<ContractFieldKey, string | number | null>> {
  const out: Partial<Record<ContractFieldKey, string | number | null>> = {};
  for (const k of EDITABLE) {
    const fk = fieldKeyOf(f.deal, k);
    if (!fk) continue;
    const was = asText(c.fields[fk]?.value);
    const v = f[k].trim();
    if (v === was.trim()) continue; // chỉ khác khoảng trắng ⇒ không phải thay đổi
    out[fk] = v === "" ? null : KIND[k] === "int" ? Number(v.replace(/\D/g, "")) : v;
  }
  return out;
}

/** Dấu hiệu của agent: "chưa kiểm chứng" (có giá trị mà chưa chứng minh bằng trích dẫn) + trích dẫn nghiêng dưới ô. */
export function badgesOf(
  c: Pick<ContractDetail, "fields" | "deal" | "direction">,
  warn: string,
): Partial<Record<TextKey, FieldBadge[]>> {
  const deal = dealOf(c);
  const out: Partial<Record<TextKey, FieldBadge[]>> = {};
  for (const k of EDITABLE) {
    const fk = fieldKeyOf(deal, k);
    const fv = fk ? c.fields[fk] : undefined;
    if (!fv) continue;
    const list: FieldBadge[] = [];
    if (!fv.verified && fv.value !== null) list.push({ kind: "warn", text: warn });
    if (fv.quote) list.push({ kind: "quote", text: fv.quote });
    if (list.length) out[k] = list;
  }
  return out;
}

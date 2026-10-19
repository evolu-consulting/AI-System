// HD-FR-26 · S05 · D-02: luật thuần màn kiểm/sửa HĐ — port `ContractPage.tsx:17-24` (SHOWN, thứ tự đọc) và `:73-79`
// (`changed`: chỉ gửi ô đã đổi; ô số bỏ mọi ký tự không phải số; rỗng ⇒ null).
import type { ContractDetail, ContractFieldKey, ContractWarning } from "@ai/contracts";

export type ShownKind = "text" | "date" | "int";
/** [khoá, key i18n nhãn, kiểu ô] theo đúng thứ tự mgmt-app. */
export const SHOWN: readonly (readonly [ContractFieldKey, string, ShownKind])[] = [
  ["number", "number", "text"],
  ["title", "title", "text"],
  ["supplier_name", "supplierName", "text"],
  ["supplier_tax_id", "supplierTaxId", "text"],
  ["buyer_name", "buyerName", "text"],
  ["buyer_tax_id", "buyerTaxId", "text"],
  ["supplier_representative", "supplierSigner", "text"],
  ["buyer_representative", "buyerSigner", "text"],
  ["start_date", "startDate", "date"],
  ["end_date", "endDate", "date"],
  ["notice_days", "noticeDays", "int"],
  ["total_value", "totalValue", "int"],
  ["payment_terms", "paymentTerms", "text"],
] as const;

/** Ô rộng hai cột (`ContractPage.tsx:147`). */
export const WIDE = new Set<ContractFieldKey>(["payment_terms", "title"]);

export type Draft = Partial<Record<ContractFieldKey, string>>;

const asText = (v: unknown): string => (v === null || v === undefined ? "" : String(v));

/** Bản nháp từ giá trị đã lưu. */
export function draftOf(c: Pick<ContractDetail, "fields">): Draft {
  return Object.fromEntries(SHOWN.map(([k]) => [k, asText(c.fields[k]?.value)]));
}

/** Ô đã đổi so với giá trị đã lưu → giá trị gửi PATCH (null khi xoá trắng). */
export function changedFields(
  c: Pick<ContractDetail, "fields">,
  draft: Draft,
): Partial<Record<ContractFieldKey, string | number | null>> {
  const out: Partial<Record<ContractFieldKey, string | number | null>> = {};
  for (const [k, , kind] of SHOWN) {
    const was = asText(c.fields[k]?.value);
    const now = draft[k] ?? "";
    if (now === was) continue;
    const v = now.trim();
    out[k] = v === "" ? null : kind === "int" ? Number(v.replace(/\D/g, "")) : v;
  }
  return out;
}

/** "chưa kiểm chứng": có giá trị mà agent chưa chứng minh bằng trích dẫn. */
export const unverified = (c: Pick<ContractDetail, "fields">, k: ContractFieldKey): boolean =>
  !!c.fields[k] && !c.fields[k].verified && c.fields[k].value !== null;

/** `warnings` của chi tiết là `unknown[]` ở contract đọc (HD1) — lấy phần có `message` chuỗi. */
export function warningsOf(c: Pick<ContractDetail, "warnings">): ContractWarning[] {
  return c.warnings.filter(
    (w): w is ContractWarning =>
      typeof w === "object" &&
      w !== null &&
      typeof (w as { message?: unknown }).message === "string",
  );
}

/** Dòng phụ dưới tiêu đề theo trạng thái (`ContractPage.tsx:93`). */
export function leadKey(status: string): string | null {
  if (status === "extracting") return "contracts.review.reading";
  if (status === "needs_review") return "contracts.review.checkLead";
  return null;
}

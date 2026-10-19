// HD-FR-25 · Q10: dựng `PartyCheck` từ kết quả tra MST Cục Thuế (port `companies/registry.py:41-48` `is_active` +
// so tên của `companies/enrich.py`). Thuần.
import { foldVi } from "./fold.rules";
import type { PartyCheck } from "./warnings.rules";
import { normalizeTaxId } from "./warnings.rules";

/** Kết quả cổng tra MST (adapter HTTP dựng). */
export type TaxLookup =
  | { result: "found"; name: string; status: string | null }
  | { result: "not_found" | "unavailable" | "invalid" };

/** "Đang hoạt động" ⇒ true; "ngừng/đóng/chấm dứt" ⇒ false; còn lại chưa rõ. */
export function isActiveStatus(status: string | null): boolean | null {
  const s = (status ?? "").toLowerCase();
  if (s.includes("đang hoạt động")) return true;
  if (["ngừng", "đóng", "chấm dứt"].some((w) => s.includes(w))) return false;
  return null;
}

const LEGAL_FORMS =
  /\b(cong ty|cty|tnhh|co phan|cp|mtv|mot thanh vien|hai thanh vien tro len|trach nhiem huu han|chi nhanh|doanh nghiep tu nhan|dntn|jsc|co\.?,? ?ltd|ltd|company|limited)\b/g;

/** Khoá so tên: bỏ dấu, bỏ loại hình doanh nghiệp và dấu câu. */
export function companyKey(name: string): string {
  return foldVi(name)
    .replace(/[^\p{L}\p{N} ]/gu, " ")
    .replace(LEGAL_FORMS, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Tên trong văn bản khớp tên Cục Thuế khi khoá bằng nhau hoặc khoá này chứa khoá kia. */
export function namesMatch(written: string, registry: string): boolean {
  const [a, b] = [companyKey(written), companyKey(registry)];
  return a.length > 0 && b.length > 0 && (a === b || a.includes(b) || b.includes(a));
}

/** Một bên của HĐ: không MST ⇒ `no_tax`; MST sai định dạng ⇒ `invalid` (đã có cảnh báo `tax_id_format`). */
export function partyCheck(
  name: string | null,
  rawTax: string | null,
  lookup: TaxLookup | null,
): PartyCheck {
  const taxId = normalizeTaxId(rawTax);
  const base: PartyCheck = {
    taxId,
    lookup: "skipped",
    registryName: null,
    status: null,
    active: null,
    nameMatch: null,
  };
  if (!rawTax) return { ...base, lookup: "no_tax" };
  if (!taxId) return { ...base, lookup: "invalid" };
  if (!lookup) return base;
  if (lookup.result !== "found") return { ...base, lookup: lookup.result };
  return {
    ...base,
    lookup: "found",
    registryName: lookup.name,
    status: lookup.status,
    active: isActiveStatus(lookup.status),
    nameMatch: name ? namesMatch(name, lookup.name) : null,
  };
}

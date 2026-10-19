// HD-FR-25 · Q10: dựng `PartyCheck` từ kết quả tra MST Cục Thuế (port `companies/registry.py:41-48` `is_active` +
// `enrich.py:20-26` `same_name` + `contracts/link.py:86-91` `party_form`). Thuần.
import type { PartyCheck } from "./warnings.rules";
import { normalizeTaxId } from "./warnings.rules";

/** Kết quả cổng tra MST (adapter HTTP dựng). `unavailable` có `retryAt` (epoch ms) khi biết lúc nên tra lại (khe 2 s / 429). */
export type TaxLookup =
  | {
      result: "found";
      name: string;
      status: string | null;
      shortName?: string | null;
      internationalName?: string | null;
    }
  | { result: "unavailable"; retryAt?: number }
  | { result: "not_found" | "invalid" };
/** "Đang hoạt động" ⇒ true; "ngừng/đóng/chấm dứt" ⇒ false; còn lại chưa rõ. */
export function isActiveStatus(status: string | null): boolean | null {
  const s = (status ?? "").toLowerCase();
  if (s.includes("đang hoạt động")) return true;
  if (["ngừng", "đóng", "chấm dứt"].some((w) => s.includes(w))) return false;
  return null;
}

/** `link.py:86` `_LEGAL` nguyên văn. */
const LEGAL = /\b(cong ty|co phan|trach nhiem huu han|tnhh|ctcp|cty|mtv|mot thanh vien)\b/g;

/** `link.py:89-91` `party_form`: bỏ dấu (`đ→d`), bỏ loại hình doanh nghiệp, bỏ mọi ký tự không phải chữ/số/`_`. */
export function partyForm(s: string | null | undefined): string {
  const folded = (s ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/đ/g, "d");
  return folded.replace(LEGAL, " ").replace(/[^\p{L}\p{N}_]/gu, "");
}

/** `enrich.py:20-26` `same_name`: bằng nhau, hoặc chứa nhau khi cả hai dài ≥ 4; so với mọi tên (chính, viết tắt, quốc tế). */
export function sameName(a: string | null, names: readonly (string | null | undefined)[]): boolean {
  const mine = partyForm(a);
  return names.some((n) => {
    const theirs = partyForm(n);
    if (!mine || !theirs) return false;
    return (
      mine === theirs ||
      (Math.min(mine.length, theirs.length) >= 4 &&
        (mine.includes(theirs) || theirs.includes(mine)))
    );
  });
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
    nameMatch: name
      ? sameName(name, [lookup.name, lookup.shortName, lookup.internationalName])
      : null,
  };
}

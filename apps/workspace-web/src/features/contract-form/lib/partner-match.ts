// CR-122 p10: logic thuần của ô chọn đối tác từ sổ — vai theo loại HĐ, MST/CCCD, gợi ý khớp khi AI đọc ra tên/MST.
import type { ContractDeal, PartnerRoleV2, PartnerSearchHit } from "@ai/contracts/pack-contracts";

export type { PartnerSearchHit };

/** Loại HĐ → vai trong sổ đối tác: Mua = NCC, Bán = Khách hàng, Giới thiệu = bên trả hoa hồng. */
export const ROLE_OF_DEAL: Record<ContractDeal, PartnerRoleV2> = {
  buy: "supplier",
  sell: "customer",
  referral: "commission_payer",
};

export const digitsOf = (s: string | null | undefined): string => (s ?? "").replace(/\D/g, "");

/** Tên không dấu, thường, gọn khoảng trắng (khớp tên không phân biệt hoa thường/dấu). */
export const foldVi = (s: string | null | undefined): string =>
  (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "d")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

/** Số 12 chữ số = CCCD của cá nhân; còn lại là MST. Một nguồn: `tax_id` của sổ đối tác. */
export const idKind = (taxId: string | null | undefined): "mst" | "cccd" =>
  digitsOf(taxId).length === 12 ? "cccd" : "mst";

export type Suggestion =
  | { kind: "sure"; hit: PartnerSearchHit }
  | { kind: "maybe"; hits: PartnerSearchHit[] }
  | { kind: "none" };

/**
 * Gợi ý khớp cho tên/MST do AI đọc: khớp MST trước (đúng một ⇒ chắc), rồi tên (đúng một tên trùng sau khi bỏ dấu ⇒ chắc, trừ khi
 * MST hai bên khác nhau). Nhiều ứng viên / chỉ gần giống ⇒ "maybe" (tối đa 3) để người dùng chọn.
 */
export function suggestMatch(
  input: { name: string; taxId: string },
  byTax: readonly PartnerSearchHit[],
  byName: readonly PartnerSearchHit[],
): Suggestion {
  const dg = digitsOf(input.taxId);
  if (dg) {
    const exact = byTax.filter((h) => digitsOf(h.tax_id) === dg);
    if (exact.length === 1 && exact[0]) return { kind: "sure", hit: exact[0] };
    if (exact.length > 1) return { kind: "maybe", hits: exact.slice(0, 3) };
  }
  const f = foldVi(input.name);
  if (!f) return { kind: "none" };
  const same = byName.filter((h) => foldVi(h.name) === f);
  const only = same.length === 1 ? same[0] : undefined;
  if (only) {
    const hd = digitsOf(only.tax_id);
    if (!dg || !hd || hd === dg) return { kind: "sure", hit: only };
    return { kind: "maybe", hits: [only] };
  }
  const cand = same.length > 1 ? same : byName;
  return cand.length > 0 ? { kind: "maybe", hits: cand.slice(0, 3) } : { kind: "none" };
}

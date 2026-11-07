// CR-110 · COM-FR-45 · COM-FR-43 · luật thuần: hàng `/company` → brand community (đúng 4 trường), quyền theo gói của người xem.
import type { CompanyBrandRow } from "./quote.types";

/** Hình khớp `CommunityBrand` / `CommunityCaps` của `@ai/contracts/community` (domain không import contracts). */
export type BrandView = {
  name: string;
  appName: string | null;
  logo: string | null;
  accent: string;
};
export type CapsView = { contracts: boolean };

const text = (v: string | null | undefined): string | null => (v?.trim() ? v : null);

/** Chưa có hàng / tên rỗng ⇒ tên tenant; màu lạ ⇒ indigo (P5-AC07). Chỉ chép 4 trường — không bao giờ trải cả hàng. */
export function toCommunityBrand<A extends string>(
  row: CompanyBrandRow | null,
  tenantName: string,
  accents: readonly A[],
  defaultAccent: A,
): BrandView & { accent: A } {
  return {
    name: text(row?.name) ?? (text(tenantName) || "?"),
    appName: text(row?.appName),
    logo: text(row?.logo),
    accent:
      row && (accents as readonly string[]).includes(row.accent)
        ? (row.accent as A)
        : defaultAccent,
  };
}

/** Đối tác (`org` ≠ null) luôn không có quyền contracts và không có link SHT (I1); chủ quản theo quyền gói. */
export function viewerCaps(
  isPartner: boolean,
  hasContracts: boolean,
  contractsUrl: string,
): { caps: CapsView; contractsUrl: string | null } {
  const contracts = !isPartner && hasContracts;
  return { caps: { contracts }, contractsUrl: contracts ? contractsUrl : null };
}

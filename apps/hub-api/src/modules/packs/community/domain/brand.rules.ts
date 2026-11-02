// CR-110 · COM-FR-45 · COM-FR-43 · luật thuần: hàng `/company` → brand community (đúng 4 trường), quyền theo gói của người xem.
import {
  COMMUNITY_BRAND_ACCENTS,
  type CommunityBrand,
  type CommunityBrandAccent,
  type CommunityCaps,
  DEFAULT_BRAND_ACCENT,
} from "@ai/contracts/community";
import type { CompanyBrandRow } from "../application/pack-ports";

const isAccent = (v: string): v is CommunityBrandAccent =>
  (COMMUNITY_BRAND_ACCENTS as readonly string[]).includes(v);
const text = (v: string | null | undefined): string | null => (v?.trim() ? v : null);

/** Chưa có hàng / tên rỗng ⇒ tên tenant; màu lạ ⇒ indigo (P5-AC07). Chỉ chép 4 trường — không bao giờ trải cả hàng. */
export function toCommunityBrand(row: CompanyBrandRow | null, tenantName: string): CommunityBrand {
  return {
    name: text(row?.name) ?? (text(tenantName) || "?"),
    appName: text(row?.appName),
    logo: text(row?.logo),
    accent: row && isAccent(row.accent) ? row.accent : DEFAULT_BRAND_ACCENT,
  };
}

/** Đối tác (`org` ≠ null) luôn không có quyền contracts và không có link SHT (I1); chủ quản theo quyền gói. */
export function viewerCaps(
  isPartner: boolean,
  hasContracts: boolean,
  contractsUrl: string,
): { caps: CommunityCaps; contractsUrl: string | null } {
  const contracts = !isPartner && hasContracts;
  return { caps: { contracts }, contractsUrl: contracts ? contractsUrl : null };
}

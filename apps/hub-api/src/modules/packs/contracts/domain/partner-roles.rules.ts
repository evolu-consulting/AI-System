// V2-C · BA 5.6b/d · HD-10: luật thuần của vai đối tác — vai theo loại HĐ (≡ SQL `contracts.partner_role_of`), nhãn MỚI theo số việc,
// và dựng kết quả gợi ý đối tác. Không I/O.
import {
  NEW_PARTNER_LABEL,
  type PartnerDeal,
  type PartnerLookup,
  type PartnerRoleV2,
  type ScoreBand,
} from "@ai/contracts";
import { partyKey } from "./ledger.rules";

/** 5.6b: Mua → NCC, Bán → khách, Giới thiệu → bên trả hoa hồng. */
export const ROLE_OF_DEAL: Record<PartnerDeal, PartnerRoleV2> = {
  buy: "supplier",
  sell: "customer",
  referral: "commission_payer",
};
/** BA 5.1 "Đối tác mới": dưới 3 việc ⇒ MỚI (mặc định khi chưa có cấu hình của vai). */
export const DEFAULT_MIN_EVENTS = 3;

export const isNewRole = (events: number, minEvents: number) => events < minEvents;

/** Khoá đối tác của ô gõ trên HĐ — đúng khoá trigger sẽ ghi khi lưu (MST có chữ số ⇒ `tax:`, không ⇒ `name:fold(tên)`). */
export const lookupKey = (name: string, tax: string | undefined): string | null =>
  partyKey(name, tax ?? null);

export type LookupHit = {
  party: string;
  name: string | null;
  tax_id: string | null;
  roles: { role: PartnerRoleV2; is_new: boolean }[];
};

export function lookupResult(
  key: string,
  hit: LookupHit | null,
  deal: PartnerDeal | undefined,
  score: { score: number | null; band: ScoreBand | null } | null,
): PartnerLookup {
  const role = deal ? ROLE_OF_DEAL[deal] : null;
  if (!hit) return { status: "new", party: key, role, label: NEW_PARTNER_LABEL };
  const mine = role ? hit.roles.find((r) => r.role === role) : undefined;
  return {
    status: "existing",
    party: hit.party,
    name: hit.name,
    tax_id: hit.tax_id,
    roles: hit.roles.map((r) => r.role),
    role,
    has_role: Boolean(mine),
    // Vai chưa có ⇒ sẽ là vai mới (MỚI); không chọn loại ⇒ MỚI khi mọi vai đều MỚI.
    is_new: role ? (mine?.is_new ?? true) : hit.roles.every((r) => r.is_new),
    score: score?.score ?? null,
    band: score?.band ?? null,
  };
}

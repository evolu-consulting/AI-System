// CR-130 pha 2 · L3 · ADR-0043: hồ sơ Bảng tin của một đối tác SHT (`/pack/contracts/partners/community*`): nhóm hàng, khu vực, tài
// khoản công ty ngoài đã gắn (`admin.external_orgs`), vai. MỘT nguồn: bảng `contracts.partner_profiles` + `partner_roles`. Thân strict.
import { z } from "zod";

const noNul = (v: string) => !v.includes("\u0000");
const Party = z.string().min(1).max(300).refine(noNul, { message: "NUL không được phép" });

export const PartnerCommunityQuerySchema = z.strictObject({ party: Party });
/** `PUT /partners/community/profile` — thay cả nhóm hàng + khu vực (chỉ quản trị gói). */
export const PartnerCommunityProfilePutSchema = z.strictObject({
  party: Party,
  cats: z.array(z.string().trim().min(1).max(80).refine(noNul)).max(50),
  area: z.string().trim().max(100).refine(noNul).default(""),
});
export type PartnerCommunityProfilePut = z.input<typeof PartnerCommunityProfilePutSchema>;
/** `PUT /partners/community/account` — `ext_org_id` = mời vào Bảng tin (gắn tài khoản); `null` = gỡ khỏi Bảng tin. */
export const PartnerCommunityAccountPutSchema = z.strictObject({
  party: Party,
  ext_org_id: z.uuid().nullable(),
});
export type PartnerCommunityAccountPut = z.infer<typeof PartnerCommunityAccountPutSchema>;

export const PARTNER_COMMUNITY_ROLES = ["supplier", "customer"] as const;
export type PartnerCommunityRole = (typeof PARTNER_COMMUNITY_ROLES)[number];
export type PartnerCommunityAccount = { id: string; name: string; active: boolean };
export type PartnerCommunity = {
  party: string;
  name: string | null;
  /** Vai Bảng tin của đối tác (từ `partner_roles`; bên trả hoa hồng không tính). */
  roles: PartnerCommunityRole[];
  cats: string[];
  area: string;
  /** Tài khoản công ty ngoài đã gắn (null = chưa mời). */
  account: PartnerCommunityAccount | null;
  invited_at: string | null;
};
/** `GET /partners/community/candidates` — tài khoản công ty ngoài còn hiệu lực, chưa gắn đối tác nào (≤ 100, theo tên). */
export type PartnerCommunityCandidate = { id: string; name: string };
export const PARTNER_COMMUNITY_CANDIDATES_MAX = 100;

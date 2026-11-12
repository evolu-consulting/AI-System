// CR-130 pha 2 · L3: cổng repo hồ sơ Bảng tin của đối tác (lớp 2 — chỉ kiểu); `adapters/partner-profile.repo.ts` cài.
export type ProfileRaw = {
  party: string;
  name: string | null;
  roles: ("supplier" | "customer")[];
  cats: string[];
  area: string;
  ext_org_id: string | null;
  invited_at: string | null;
};
export type PartnerProfileRepo = {
  /** Đối tác ngoài phạm vi (không vai/danh bạ người dùng thấy) ⇒ null. */
  get(party: string): Promise<ProfileRaw | null>;
  saveProfile(party: string, cats: string[], area: string): Promise<{ ok: true } | null>;
  /** `null` = gỡ. Tài khoản đã gắn đối tác khác ⇒ ném lỗi PG 23505. */
  setAccount(party: string, orgId: string | null): Promise<{ ok: true } | null>;
  linkedOrgs(): Promise<string[]>;
};

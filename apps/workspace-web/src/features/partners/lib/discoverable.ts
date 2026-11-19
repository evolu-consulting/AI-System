// CR-187 BR-187-5 · luật công tắc «Cho công ty khác tìm thấy công ty mình» (chuyển từ Admin › Công ty › Hồ sơ). Logic thuần.
import type { TenantCompanyProfile } from "@ai/contracts/tenants";

type P = Pick<TenantCompanyProfile, "legal_name" | "tax_code" | "directory_listed">;

/** Chỉ quản trị công ty thấy và đổi (quản trị nền tảng không bật hộ công ty, vai khác không thấy). */
export const canSeeDiscoverable = (role: string | undefined): boolean => role === "tenant_admin";

export type DiscoverableView = {
  checked: boolean;
  /** Bật được khi đã có tên pháp lý + MST; đang bật thì luôn tắt được. */
  enabled: boolean;
  /** `true` ⇒ chưa đủ hồ sơ: hiện lý do. */
  needProfile: boolean;
};

export function discoverableView(p: P): DiscoverableView {
  const hasProfile = Boolean(p.legal_name && p.tax_code);
  return {
    checked: p.directory_listed,
    enabled: p.directory_listed || hasProfile,
    needProfile: !p.directory_listed && !hasProfile,
  };
}

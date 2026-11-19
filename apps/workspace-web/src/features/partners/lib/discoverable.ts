// CR-187 BR-187-5 · CR-191 · luật công tắc «Cho công ty khác tìm thấy công ty mình». Logic thuần.
import type { ConnectListing } from "@ai/contracts/pack-contracts";

export type DiscoverableView = {
  checked: boolean;
  /** Bật được khi đã có tên pháp lý + MST (đang bật thì luôn tắt được); chỉ người quản trị Sổ Hợp Tác đổi. */
  enabled: boolean;
  /** `true` ⇒ chưa đủ hồ sơ: hiện lý do. */
  needProfile: boolean;
  /** `true` ⇒ không phải quản trị Sổ Hợp Tác: khoá + nói lý do. */
  locked: boolean;
};

export function discoverableView(p: ConnectListing, isAdmin: boolean): DiscoverableView {
  const needProfile = !p.listed && !p.has_profile;
  return {
    checked: p.listed,
    enabled: isAdmin && (p.listed || p.has_profile),
    needProfile,
    locked: !isAdmin,
  };
}

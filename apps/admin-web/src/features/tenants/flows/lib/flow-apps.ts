// CR-130 · ADR-0044 · app chọn được khi tạo quy trình công ty: gói đang bật, riêng «Bảng tin» (`community`) = mặt của gói contracts nên
// có khi công ty bật gói contracts VÀ add-on `contracts-community` (không còn gói `community`). Thuần, test được.

/** Khoá add-on bật Bảng tin (ADR-0044). */
export const COMMUNITY_ADDON = "contracts-community";

export function flowAppsOf(
  all: readonly string[],
  enabledPacks: ReadonlySet<string>,
  entitledFeatures: ReadonlySet<string>,
): string[] {
  const community = enabledPacks.has("contracts") && entitledFeatures.has(COMMUNITY_ADDON);
  return all.filter((a) => enabledPacks.has(a) || (a === "community" && community));
}

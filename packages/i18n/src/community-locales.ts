// COM-FR-46 · chuỗi riêng của community-web: một namespace `community.*` (lồng theo tính năng), vi/en cùng tập key.
// `vi` là bản gốc + dự phòng (thiếu EN ⇒ hiện VI) nên gói tĩnh; `en` nạp động thành chunk riêng.

import vi from "../locales/community/vi.json";
import type { Locale } from "./locales";

/** Bản VI (gốc, gói tĩnh để dùng đồng bộ trong logic thuần và test). */
export const communityVi = vi as Record<string, unknown>;

/** Nạp bản dịch community của một ngôn ngữ khi cần. */
export async function loadCommunityLocale(locale: Locale): Promise<Record<string, unknown>> {
  if (locale === "en")
    return (await import("../locales/community/en.json")).default as Record<string, unknown>;
  return communityVi;
}

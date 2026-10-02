// ADM-FR-24 · M2-R23 · tóm tắt trên tab "Ai dùng được": "n tenant · m user" (m = số user THẤY thật, M3-R14); quá 1 trang thì không cộng được user nên chỉ nêu số tenant.
import type { Translate } from "@/lib/format";
import { ACCESS_PAGE_SIZE } from "../api";

export function accessSummary(
  t: Translate,
  total: number,
  items: readonly { visible_user_count: number }[],
): string {
  if (total > ACCESS_PAGE_SIZE) return t("commands.access.summaryTenants", { tenants: total });
  const users = items.reduce((sum, i) => sum + i.visible_user_count, 0);
  return t("commands.access.summary", { tenants: total, users });
}

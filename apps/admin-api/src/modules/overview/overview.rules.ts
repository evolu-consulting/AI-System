// ADM-FR-44, ADM-FR-40 · ui 7.2 · Q5 · hàm thuần của trang Tổng quan (plan-contract §2.3). Không I/O.
import type { Level } from "../quotas/quotas.rules";

export type QuotaTenantIn = {
  tenant_id: string;
  tenant_key: string;
  tenant_name: string;
  pct: number | null;
  level: Level;
};
export type QuotaTenantOut = Omit<QuotaTenantIn, "pct"> & { pct: number };

/** Tenant có level ≠ none (pct = max các quota của tenant), pct giảm rồi key tăng, cắt `limit`. */
export function rankQuotaTenants(rows: readonly QuotaTenantIn[], limit: number): QuotaTenantOut[] {
  const hot = rows.filter((r): r is QuotaTenantOut => r.level !== "none" && r.pct !== null);
  hot.sort(
    (a, b) =>
      b.pct - a.pct || (a.tenant_key < b.tenant_key ? -1 : a.tenant_key > b.tenant_key ? 1 : 0),
  );
  return hot.slice(0, limit);
}

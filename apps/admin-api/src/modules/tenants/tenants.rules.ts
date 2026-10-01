// ADM-FR-60, ADM-FR-61 · luật tenants dạng hàm thuần (plan M1 §4).
import type { ErrorCode, Role } from "@ai/contracts";

export const PLATFORM_TENANT_KEY = "platform";

export type RuleError = { code: ErrorCode; details?: unknown };

/** Chỉ platform_admin quản lý tenant (M1-R12). */
export function canManageTenants(actor: { role: Role }): boolean {
  return actor.role === "platform_admin";
}

/** Tenant `platform` không khoá được (M1-R10). */
export function checkTenantLock(tenant: { key: string }): RuleError | null {
  return tenant.key === PLATFORM_TENANT_KEY ? { code: "PLATFORM_TENANT_LOCKED" } : null;
}

export function tenantStatus(t: { active: boolean }): "active" | "locked" {
  return t.active ? "active" : "locked";
}

/** PATCH: chỉ trường gửi lên và khác giá trị hiện tại mới tính là đổi (không đổi → không tăng version). */
export function changedTenantFields(
  current: { name: string; maxConcurrentSub: number | null },
  patch: { name?: string; max_concurrent_sub?: number | null },
): { name?: string; maxConcurrentSub?: number | null } {
  const out: { name?: string; maxConcurrentSub?: number | null } = {};
  if (patch.name !== undefined && patch.name !== current.name) out.name = patch.name;
  if (
    patch.max_concurrent_sub !== undefined &&
    patch.max_concurrent_sub !== current.maxConcurrentSub
  ) {
    out.maxConcurrentSub = patch.max_concurrent_sub;
  }
  return out;
}

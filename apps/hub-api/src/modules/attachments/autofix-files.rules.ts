// HUB-FR-128 · HUB-BR-14 · HUB-BR-25 · PC-R14 · P-c1 B5b (plan §6.6) · luật thuần đọc file diff/log tự sửa theo quyền xem run.
import type { RunAccess } from "../processes/domain/runs/run-access.rules";

/** Tenant để tra file tự sửa: platform_admin + `?tenant_id` ⇒ tenant đó (như `/process-runs/:id/outputs`); vai khác bỏ qua. */
export function autofixReadTenant(
  u: { role: string; tenantId: string },
  tenantIdQ: string | undefined,
): string {
  return u.role === "platform_admin" && tenantIdQ ? tenantIdQ : u.tenantId;
}

/** Đọc được ⇔ người xem có quyền xem run (`full` hoặc `task`); null ⇒ 404 cùng thân (không lộ tồn tại). */
export const canReadAutofixFile = (access: RunAccess | null): boolean => access !== null;

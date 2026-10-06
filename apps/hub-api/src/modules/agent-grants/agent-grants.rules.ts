// HUB-FR-78 · H3b-R01/R02/R04 · luật thuần của API cấp quyền agent (plan H3b §4.1).
import type { Role } from "@ai/contracts";

/** H3b-R01/R02 · quyết tenant đích một lần (chưa kiểm tồn tại — service làm với platform_admin). */
export type TargetTenant =
  | { ok: true; tenantId: string }
  | { ok: false; code: "FORBIDDEN" | "TENANT_REQUIRED" | "NOT_FOUND" };

export function targetTenant(
  user: { role: Role; tenantId: string },
  queryTenantId: string | undefined,
): TargetTenant {
  if (user.role === "tenant_admin") {
    // Tenant khác ⇒ NOT_FOUND, không FORBIDDEN: không lộ tenant đó có tồn tại (HUB-BR-14).
    return queryTenantId === undefined || queryTenantId === user.tenantId
      ? { ok: true, tenantId: user.tenantId }
      : { ok: false, code: "NOT_FOUND" };
  }
  if (user.role === "platform_admin") {
    return queryTenantId === undefined
      ? { ok: false, code: "TENANT_REQUIRED" }
      : { ok: true, tenantId: queryTenantId };
  }
  // member và role lạ (JWT hỏng/đời cũ) đều chặn — mặc định từ chối.
  return { ok: false, code: "FORBIDDEN" };
}

/** H3b-R04 · thứ tự lỗi khi cấp (đầu vào đã đọc từ DB; null = cấp được). */
export type GrantCheck = {
  agent: { isOrchestrator: boolean; entitled: boolean } | null;
  subjectInTenant: boolean;
};
export type GrantProblem =
  | "AGENT_NOT_FOUND_REF"
  | "AGENT_NOT_GRANTABLE"
  | "NOT_ENTITLED"
  | "SUBJECT_NOT_FOUND_REF";

/** Không nhận role: platform_admin cũng không được bỏ qua bước nào (R04). */
export function grantProblem(c: GrantCheck): GrantProblem | null {
  if (c.agent === null) return "AGENT_NOT_FOUND_REF";
  if (c.agent.isOrchestrator) return "AGENT_NOT_GRANTABLE";
  if (!c.agent.entitled) return "NOT_ENTITLED";
  if (!c.subjectInTenant) return "SUBJECT_NOT_FOUND_REF";
  return null;
}

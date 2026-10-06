// HUB-FR-78 · H3b-R01/R02/R04 · luật thuần của API cấp quyền agent (plan H3b §4.1). Stub B0, thân ở B2.
import type { Role } from "@ai/contracts";

/** H3b-R01/R02 · quyết tenant đích một lần (chưa kiểm tồn tại — service làm với platform_admin). */
export type TargetTenant =
  | { ok: true; tenantId: string }
  | { ok: false; code: "FORBIDDEN" | "TENANT_REQUIRED" | "NOT_FOUND" };

export function targetTenant(
  _user: { role: Role; tenantId: string },
  _queryTenantId: string | undefined,
): TargetTenant {
  throw new Error("not implemented");
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

export function grantProblem(_c: GrantCheck): GrantProblem | null {
  throw new Error("not implemented");
}

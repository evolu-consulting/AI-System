// HUB-FR-78 · hàm thuần cho ma trận Quyền agent: tra ô, lọc phía client (≤ 200, readiness lần 3), cập nhật lạc quan (D9).
import type { EntitlementMatrix } from "@ai/contracts/studio";

export type Cell = EntitlementMatrix["cells"][number];
export type MatrixAgent = EntitlementMatrix["agents"][number];
export type MatrixTenant = EntitlementMatrix["tenants"][number];
export type Ref = { agentId: string; tenantId: string };

export const cellKey = (agentId: string, tenantId: string) => `${agentId}|${tenantId}`;

export function indexCells(cells: readonly Cell[]): Map<string, Cell> {
  return new Map(cells.map((c) => [cellKey(c.agent_id, c.tenant_id), c]));
}

/** `""` = Tất cả. Id không còn trong ma trận ⇒ coi như Tất cả. */
export function filterMatrix(m: EntitlementMatrix, agentId: string, tenantId: string) {
  const agents = agentId ? m.agents.filter((a) => a.id === agentId) : m.agents;
  const tenants = tenantId ? m.tenants.filter((t) => t.id === tenantId) : m.tenants;
  return {
    agents: agents.length > 0 ? agents : m.agents,
    tenants: tenants.length > 0 ? tenants : m.tenants,
  };
}

/** Ô không áp dụng: agent chỉ dùng cho một tenant khác (Orchestrator riêng) ⇒ hiện "—", không có switch. */
export const isNotApplicable = (a: MatrixAgent, t: MatrixTenant) =>
  a.only_tenant_id !== null && a.only_tenant_id !== t.id;

/** Bản ma trận mới với ô `ref` được đặt (`cell`) hoặc gỡ (`null`); không đổi bản cũ. */
export function withCell(m: EntitlementMatrix, ref: Ref, cell: Cell | null): EntitlementMatrix {
  const rest = m.cells.filter((c) => c.agent_id !== ref.agentId || c.tenant_id !== ref.tenantId);
  return { ...m, cells: cell ? [...rest, cell] : rest };
}

export function grantedCell(ref: Ref, count: number, at: string): Cell {
  return {
    agent_id: ref.agentId,
    tenant_id: ref.tenantId,
    granted_at: at,
    grant_count: count,
    grants: { group: 0, user: 0, tenant: 0 },
  };
}

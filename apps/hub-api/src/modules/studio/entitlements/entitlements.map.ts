// HUB-FR-78 · spec H4b2 §3 C · plan §2.4 · hàng DB → `EntitlementMatrix` / `EntitlementCellDetail` (thuần, không DB).
import type { EntitlementCellDetail, EntitlementMatrix } from "@ai/contracts/studio";
import type {
  CellAgentRow,
  CellEntRow,
  CellGrantRow,
  CellTenantRow,
  EntRow,
  GrantCountRow,
  MatrixAgentRow,
  MatrixTenantRow,
} from "./entitlements.repo";

const iso = (d: Date | string): string => new Date(d).toISOString();
const isoOrNull = (d: Date | string | null): string | null => (d === null ? null : iso(d));
const pairKey = (agentId: string, tenantId: string) => `${agentId}|${tenantId}`;

export type MatrixInput = {
  agents: readonly MatrixAgentRow[];
  tenants: readonly MatrixTenantRow[];
  ents: readonly EntRow[];
  grantCounts: readonly GrantCountRow[];
  version: number;
};

type Counts = { group: number; user: number; tenant: number };

function countsByPair(rows: readonly GrantCountRow[]): Map<string, Counts> {
  const m = new Map<string, Counts>();
  for (const r of rows) {
    const k = pairKey(r.agent_id, r.tenant_id);
    const c = m.get(k) ?? { group: 0, user: 0, tenant: 0 };
    c[r.subject_type] += Number(r.n);
    m.set(k, c);
  }
  return m;
}

/**
 * Ma trận: agents/tenants cắt ở `limit` (`truncated` khi bất kỳ bên nào vượt); `cells` = entitlement chưa thu hồi thuộc
 * agents × tenants đã trả, `grants` đếm theo loại (thiếu ⇒ 0), `grant_count` = tổng.
 */
export function toMatrix(i: MatrixInput, limit = 200): EntitlementMatrix {
  const agents = i.agents.slice(0, limit);
  const tenants = i.tenants.slice(0, limit);
  const agentIds = new Set(agents.map((a) => a.id));
  const tenantIds = new Set(tenants.map((t) => t.id));
  const counts = countsByPair(i.grantCounts);
  return {
    agents: agents.map((a) => ({
      id: a.id,
      key: a.key,
      name: a.name.vi,
      enabled: a.enabled,
      is_orchestrator: a.is_orch,
      only_tenant_id: a.is_orch ? a.only_tenant_id : null,
    })),
    tenants: tenants.map((t) => ({ id: t.id, key: t.key, name: t.name, active: t.active })),
    cells: i.ents
      .filter((e) => agentIds.has(e.agent_id) && tenantIds.has(e.tenant_id))
      .map((e) => {
        const g = counts.get(pairKey(e.agent_id, e.tenant_id)) ?? { group: 0, user: 0, tenant: 0 };
        return {
          agent_id: e.agent_id,
          tenant_id: e.tenant_id,
          granted_at: iso(e.granted_at),
          grant_count: g.group + g.user + g.tenant,
          grants: g,
        };
      }),
    truncated: i.agents.length > limit || i.tenants.length > limit,
    hub_config_version: i.version,
  };
}

function subjectName(g: CellGrantRow): string {
  if (g.subject_type === "group") return g.group_name?.vi ?? g.subject_id;
  if (g.subject_type === "user") return g.user_name ?? g.subject_id;
  return g.tenant_name ?? g.subject_id;
}

export type CellInput = {
  agent: CellAgentRow;
  tenant: CellTenantRow;
  ent: CellEntRow | undefined;
  grants: readonly CellGrantRow[];
};

/** Drawer ô: `entitled` = có hàng và chưa thu hồi; grant hiện cả khi đã thu hồi; subject vắng tên ⇒ dùng id. */
export function toCellDetail(i: CellInput, limit = 200): EntitlementCellDetail {
  const e = i.ent;
  return {
    agent: { id: i.agent.id, key: i.agent.key, name: i.agent.name.vi },
    tenant: { id: i.tenant.id, key: i.tenant.key, name: i.tenant.name },
    entitled: e !== undefined && e.revoked_at === null,
    granted_at: e ? iso(e.granted_at) : null,
    granted_by:
      e?.granted_by && e.granted_by_username !== null
        ? { id: e.granted_by, username: e.granted_by_username }
        : null,
    revoked_at: e ? isoOrNull(e.revoked_at) : null,
    grants: i.grants.slice(0, limit).map((g) => ({
      id: g.id,
      subject_type: g.subject_type,
      subject: { id: g.subject_id, name: subjectName(g) },
      granted_by_username: g.granted_by_username,
      granted_at: iso(g.granted_at),
    })),
    grants_truncated: i.grants.length > limit,
  };
}

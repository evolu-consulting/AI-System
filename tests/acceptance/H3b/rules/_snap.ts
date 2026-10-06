// HUB-FR-79 · dựng ảnh cấu hình cho `effectiveAgents` (test-plan-cases H3b §1.3): kiểu `AccessSnapshot` H1 + `runtime`/`name`.
// Không chứa `it(...)`. Input đóng băng sâu (R29).

import type { EffectiveInput } from "../../../../apps/hub-api/src/modules/agent-grants/agent-effective.rules";
import type {
  EntitlementRow,
  GrantRow,
} from "../../../../apps/hub-api/src/modules/agents/agent-access.rules";

export type Snap = EffectiveInput["snapshot"];
export type SnapAgent = Snap["agents"][number];

const id = (n: number) => `e3b00000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const TEN = { acme: id(1), beta: id(2) } as const;
export const USR = { lan: id(11), hoa: id(12) } as const;
export const GR = { g1: id(21), g2: id(22), g3: id(23) } as const;
export const AID = {
  hoadon: id(31),
  cu: id(32),
  khodu: id(33),
  orch: id(34),
  orchT: id(35),
  chua: id(36),
  x: id(37),
} as const;
export const idN = (n: number) => id(1000 + n);

export function agent(
  agentId: string,
  key: string,
  o: { enabled?: boolean; runtime?: string } = {},
): SnapAgent {
  return {
    id: agentId,
    key,
    enabled: o.enabled ?? true,
    description: `Agent ${key}`,
    runtime: o.runtime ?? "agentic-cli",
    name: { vi: key, en: key },
  };
}
export const ent = (agentId: string, tenantId = TEN.acme, revoked = false): EntitlementRow => ({
  agentId,
  tenantId,
  revokedAt: revoked ? new Date("2026-10-01T00:00:00Z") : null,
});
export const grant = (agentId: string, subject: string, tenantId = TEN.acme): GrantRow => ({
  agentId,
  tenantId,
  subject,
});

export function snap(p: {
  agents: SnapAgent[];
  entitlements?: EntitlementRow[];
  grants?: GrantRow[];
  orch?: string | null;
  orchTenants?: [string, string][];
}): Snap {
  return {
    agents: p.agents,
    entitlements: p.entitlements ?? [],
    grants: p.grants ?? [],
    orchestrator: p.orch ? { agentId: p.orch } : null,
    orchestratorTenants: new Map((p.orchTenants ?? []).map(([t, a]) => [t, { agentId: a }])),
  };
}

export function input(
  s: Snap,
  o: {
    tenantActive?: boolean;
    userId?: string;
    active?: boolean;
    locked?: boolean;
    groups?: string[];
  } = {},
): EffectiveInput {
  return {
    snapshot: s,
    tenantId: TEN.acme,
    tenantActive: o.tenantActive ?? true,
    user: {
      id: o.userId ?? USR.lan,
      active: o.active ?? true,
      lockedByTenant: o.locked ?? false,
      groupIds: new Set(o.groups ?? [GR.g1, GR.g2]),
    },
  };
}

/** Đóng băng sâu (Map/Set giữ nguyên tham chiếu — chỉ đóng băng object/mảng). */
export function deepFreeze<V>(v: V): V {
  if (v && typeof v === "object" && !(v instanceof Map) && !(v instanceof Set)) {
    for (const x of Object.values(v)) deepFreeze(x);
    Object.freeze(v);
  }
  return v;
}

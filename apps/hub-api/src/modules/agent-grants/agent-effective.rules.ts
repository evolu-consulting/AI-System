// HUB-FR-79 · H3b-R12..R15 · quyền hiệu lực của user với agent (plan H3b §4.2).
import type { AgentMissing } from "@ai/contracts/hub-admin";
import {
  type AccessSnapshot,
  type AgentRow,
  orchestratorIds,
  RUNNABLE_RUNTIMES,
} from "../agents/agent-access.rules";

export type EffectiveInput = {
  snapshot: AccessSnapshot & {
    agents: readonly (AgentRow & { runtime: string; name: { vi: string; en: string } })[];
  };
  tenantId: string;
  tenantActive: boolean;
  user: { id: string; active: boolean; lockedByTenant: boolean; groupIds: ReadonlySet<string> };
};

type Reason = { code: "grant_user" } | { code: "grant_group"; groupId: string };

export type EffectiveAgentCalc = {
  agentId: string;
  key: string;
  visible: boolean;
  reasons: Reason[];
  missing: AgentMissing[];
};

type TenantIndex = {
  entitled: Set<string>;
  /** Agent có ≥ 1 grant của T, subject bất kỳ (R13 — giải thích grant còn giữ). */
  granted: Set<string>;
  reasons: Map<string, Reason[]>;
};

/** Chỉ đọc entitlement/grant của T; reasons khử trùng theo subject. */
function indexTenant(i: EffectiveInput): TenantIndex {
  const entitled = new Set<string>();
  for (const e of i.snapshot.entitlements) {
    if (e.tenantId === i.tenantId && e.revokedAt === null) entitled.add(e.agentId);
  }
  const granted = new Set<string>();
  const reasons = new Map<string, Reason[]>();
  const seen = new Set<string>();
  for (const g of i.snapshot.grants) {
    if (g.tenantId !== i.tenantId) continue;
    granted.add(g.agentId);
    const isUser = g.subject === i.user.id;
    if (!isUser && !i.user.groupIds.has(g.subject)) continue;
    const dedup = `${g.agentId}|${g.subject}`;
    if (seen.has(dedup)) continue;
    seen.add(dedup);
    const r: Reason = isUser ? { code: "grant_user" } : { code: "grant_group", groupId: g.subject };
    reasons.set(g.agentId, [...(reasons.get(g.agentId) ?? []), r]);
  }
  return { entitled, granted, reasons };
}

/** Thứ tự đẩy = thứ tự `AGENT_MISSING` (R14). */
function missingOf(
  i: EffectiveInput,
  a: { enabled: boolean; runtime: string },
  entitled: boolean,
  hasReason: boolean,
): AgentMissing[] {
  const m: AgentMissing[] = [];
  if (!i.user.active) m.push("user_inactive");
  if (!i.tenantActive || i.user.lockedByTenant) m.push("tenant_locked");
  if (!a.enabled) m.push("agent_disabled");
  if (!RUNNABLE_RUNTIMES.has(a.runtime)) m.push("runtime_unavailable");
  if (!entitled) m.push("no_entitlement");
  if (!hasReason) m.push("no_grant");
  return m;
}

/**
 * Cùng điều kiện với `visibleAgents(accessInput(…))` (R12 — một sự thật) nhưng giữ cả agent không thấy để giải thích;
 * phạm vi R13 không lộ agent chưa từng liên quan tới T. Không sửa input.
 */
export function effectiveAgents(i: EffectiveInput): EffectiveAgentCalc[] {
  const idx = indexTenant(i);
  const orch = orchestratorIds(i.snapshot);
  return i.snapshot.agents
    .filter((a) => !orch.has(a.id) && (idx.entitled.has(a.id) || idx.granted.has(a.id)))
    .map((a) => {
      const reasons = idx.reasons.get(a.id) ?? [];
      const missing = missingOf(i, a, idx.entitled.has(a.id), reasons.length > 0);
      return { agentId: a.id, key: a.key, visible: missing.length === 0, reasons, missing };
    })
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

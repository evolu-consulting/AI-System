// HUB-FR-89 · Quyền thấy agent (plan §6.4). Stub B0.
import type { AgentRef } from "@ai/contracts";

export type AgentRow = { id: string; key: string; enabled: boolean };
export type EntitlementRow = { agentId: string; tenantId: string; revokedAt: Date | null };
export type GrantRow = { agentId: string; tenantId: string; subject: string };

export type VisibleAgentsInput = {
  agents: readonly AgentRow[];
  entitlements: readonly EntitlementRow[];
  grants: readonly GrantRow[];
  tenantId: string;
  userId: string;
  groupIds: ReadonlySet<string>;
  orchestratorId: string;
};

export function visibleAgents(_i: VisibleAgentsInput): AgentRef[] {
  throw new Error("not implemented");
}

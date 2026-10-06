// HUB-FR-79 · H3b-R12..R15 · quyền hiệu lực của user với agent (plan H3b §4.2). Stub B0, thân ở B2.
import type { AgentMissing } from "@ai/contracts/hub-admin";
import type { AccessSnapshot, AgentRow } from "../agents/agent-access.rules";

export type EffectiveInput = {
  snapshot: AccessSnapshot & {
    agents: readonly (AgentRow & { runtime: string; name: { vi: string; en: string } })[];
  };
  tenantId: string;
  tenantActive: boolean;
  user: { id: string; active: boolean; lockedByTenant: boolean; groupIds: ReadonlySet<string> };
};

export type EffectiveAgentCalc = {
  agentId: string;
  key: string;
  visible: boolean;
  reasons: ({ code: "grant_user" } | { code: "grant_group"; groupId: string })[];
  missing: AgentMissing[];
};

export function effectiveAgents(_i: EffectiveInput): EffectiveAgentCalc[] {
  throw new Error("not implemented");
}

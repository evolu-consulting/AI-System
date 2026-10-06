// HUB-FR-60 · HUB-FR-64 · H4a-R08, R11 · plan §2.3, §5.1 · hàng DB → `Agent`/`AgentListItem`/bản audit (hàm thuần).
import type {
  Agent,
  AgentListItem,
  AgentRuntime,
  AgentWarning,
  SimilarAgent,
} from "@ai/contracts/studio";
import { RUNNABLE_RUNTIMES } from "../../agents/agent-access.rules";
import { hasDifyInput } from "../studio-read.map";
import type { AgentDbRow, AgentListDbRow, OrchScope, WorkflowDbRow } from "./agents.repo";
import { agentWarnings, type WorkflowRef } from "./agents.rules";

export const toWorkflowRef = (w: WorkflowDbRow): WorkflowRef => ({
  id: w.id,
  key: w.key,
  enabled: w.enabled,
  appType: w.appType,
  hasDifyInput: hasDifyInput(w.inputSchema),
});

export const orchestratorOf = (scopes: readonly OrchScope[]): Agent["orchestrator_of"] => ({
  default: scopes.some((s) => s.tenantId === null),
  tenant_ids: scopes.flatMap((s) => (s.tenantId === null ? [] : [s.tenantId])).sort(),
});

export type AgentParts = {
  row: AgentDbRow;
  workflowIds: readonly string[];
  workflows: readonly WorkflowDbRow[];
  scopes: readonly OrchScope[];
  similar: readonly SimilarAgent[];
};

/** `workflows` theo thứ tự `workflow_ids`; id đã mất khỏi catalog chỉ còn trong `workflow_ids` (E2). */
export function toAgent(p: AgentParts): Agent {
  const r = p.row;
  const runtime = r.runtime as AgentRuntime;
  const byId = new Map(p.workflows.map((w) => [w.id, w]));
  const warnings: AgentWarning[] = [
    ...p.similar.map((s) => ({ code: "description_overlap" as const, ...s })),
    ...agentWarnings({ runtime, runtime_options: r.runtimeOptions }),
  ];
  return {
    id: r.id,
    key: r.key,
    name: r.name,
    description: r.description,
    runtime,
    agent_type_key: r.agentTypeKey,
    profile_id: r.profileId,
    system_prompt: r.systemPrompt,
    runtime_options: r.runtimeOptions,
    workflow_ids: [...p.workflowIds],
    timeout_s: r.timeoutS,
    token_budget: r.tokenBudget,
    enabled: r.enabled,
    version: r.version,
    created_at: r.createdAt,
    updated_at: r.updatedAt,
    runnable: RUNNABLE_RUNTIMES.has(runtime),
    orchestrator_of: orchestratorOf(p.scopes),
    workflows: p.workflowIds.flatMap((id) => {
      const w = byId.get(id);
      return w
        ? [
            {
              id: w.id,
              key: w.key,
              name: w.name,
              app_type: w.appType,
              description: w.description,
              enabled: w.enabled,
            },
          ]
        : [];
    }),
    warnings,
  };
}

/** Bản `before`/`after` của audit: `Agent` bỏ phần suy diễn lúc đọc (plan §5.1). */
export function auditSnapshot(a: Agent): Record<string, unknown> {
  const { warnings: _w, runnable: _r, orchestrator_of: _o, ...rest } = a;
  return rest;
}

export function toListItem(r: AgentListDbRow): AgentListItem {
  const runtime = r.runtime as AgentRuntime;
  return {
    id: r.id,
    key: r.key,
    name: r.name,
    description: r.description,
    runtime,
    enabled: r.enabled,
    version: r.version,
    updated_at: r.updatedAt,
    profile:
      r.profileId !== null && r.profileKey !== null ? { id: r.profileId, key: r.profileKey } : null,
    workflow_count: r.workflowCount,
    entitled_tenant_count: r.entitledTenantCount,
    orchestrator_of: { default: r.orchDefault, tenant_ids: r.orchTenants },
    runnable: RUNNABLE_RUNTIMES.has(runtime),
  };
}

/** Trường không tính là "đổi" (DB tự sinh). */
const META_FIELDS = new Set(["id", "version", "created_at", "updated_at"]);

/** `summary.fields` của audit: khoá có giá trị khác (`before` null ⇒ mọi khoá của `after`), sắp xếp. */
export function changedFields(
  before: Record<string, unknown> | null,
  after: Record<string, unknown>,
): string[] {
  return Object.keys(after)
    .filter((k) => !META_FIELDS.has(k))
    .filter((k) => before === null || JSON.stringify(before[k]) !== JSON.stringify(after[k]))
    .sort();
}

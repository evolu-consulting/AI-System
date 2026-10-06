// HUB-FR-62 · HUB-FR-69 · H4a-R08, R09 · plan §2.4, §5.1 · hàng DB → `Orchestrator` (contract) + ảnh audit (bỏ `warnings`).
import type { AgentRuntime, Orchestrator } from "@ai/contracts/studio";
import type { OrchDbRow } from "./orchestrator.repo";
import { orchestratorWarnings } from "./orchestrator-settings.rules";

/** `agent.name` = tên `vi` (contract `string`; FE hiển thị "{name} ({key})"). Tenant vắng tên ⇒ null = mặc định. */
export function toOrchestrator(r: OrchDbRow): Orchestrator {
  const runtime = r.agentRuntime as AgentRuntime;
  return {
    id: r.id,
    tenant:
      r.tenantId === null
        ? null
        : { id: r.tenantId, key: r.tenantKey ?? "", name: r.tenantName ?? "" },
    agent: {
      id: r.agentId,
      key: r.agentKey,
      name: r.agentName.vi,
      runtime,
      enabled: r.agentEnabled,
    },
    max_steps: r.maxSteps,
    token_budget: r.tokenBudget,
    history_n: r.historyN,
    on_no_match: r.onNoMatch,
    version: r.version,
    updated_by: r.updatedBy,
    updated_at: r.updatedAt,
    warnings: orchestratorWarnings(runtime),
  };
}

/** plan §5.1: before/after = `Orchestrator` bỏ `warnings`. */
export function orchSnapshot(o: Orchestrator): Record<string, unknown> {
  const { warnings: _w, ...rest } = o;
  return rest;
}

const DIFF_KEYS = ["agent", "max_steps", "token_budget", "history_n", "on_no_match"] as const;

/** `summary.fields`: khoá nghiệp vụ đổi (agent so theo id). `before` null ⇒ mọi khoá. */
export function orchChangedFields(before: Orchestrator | null, after: Orchestrator): string[] {
  if (before === null) return [...DIFF_KEYS];
  return DIFF_KEYS.filter((k) =>
    k === "agent" ? before.agent.id !== after.agent.id : before[k] !== after[k],
  );
}

/** `entity_name` audit: `orchestrator:default` / `orchestrator:<tenant_key>`. */
export function orchEntityName(o: Orchestrator): string {
  return `orchestrator:${o.tenant?.key ?? "default"}`;
}

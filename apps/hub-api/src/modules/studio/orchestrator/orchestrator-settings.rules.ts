// HUB-FR-62 · H4a-R07, R08 · QB1 · plan P9, §4.2 · luật thuần Orchestrator Studio (QC test trước —
// `tests/acceptance/H4a/rules/orchestrator-overlap.test.ts`). Runtime hợp lệ = `ORCHESTRATOR_RUNTIMES` (một nguồn, contracts).
import { type AgentRuntime, ORCHESTRATOR_RUNTIMES } from "@ai/contracts/studio";

const ORCH_RUNTIMES: ReadonlySet<string> = new Set(ORCHESTRATOR_RUNTIMES);

export type OrchestratorAgentProblem = "not_found" | "disabled" | "runtime_unsupported";
export type OrchestratorWarning = "agentic_cli_slow";
export type TenantOrchestratorProblem = "not_found" | "inactive" | "exists";

/** Runtime ∈ `ORCHESTRATOR_RUNTIMES` (QB1: chỉ `agentic-cli`). */
export function isOrchestratorRuntime(runtime: string): boolean {
  return ORCH_RUNTIMES.has(runtime);
}

/** Vắng ⇒ not_found (400 `INVALID_REFERENCE{agent_id}`); tắt ⇒ disabled; runtime ngoài hằng ⇒ runtime_unsupported (409). */
export function orchestratorAgentProblem(
  a: { enabled: boolean; runtime: AgentRuntime } | undefined,
): OrchestratorAgentProblem | null {
  if (!a) return "not_found";
  if (!a.enabled) return "disabled";
  if (!isOrchestratorRuntime(a.runtime)) return "runtime_unsupported";
  return null;
}

/** R08: `agentic-cli` làm Orchestrator ⇒ UI cảnh báo "Chậm…". */
export function orchestratorWarnings(runtime: AgentRuntime): OrchestratorWarning[] {
  return runtime === "agentic-cli" ? ["agentic_cli_slow"] : [];
}

/** R07 · thứ tự: tenant vắng → tenant khoá → đã có bản. */
export function tenantOrchestratorProblem(
  t: { active: boolean } | undefined,
  exists: boolean,
): TenantOrchestratorProblem | null {
  if (!t) return "not_found";
  if (!t.active) return "inactive";
  if (exists) return "exists";
  return null;
}

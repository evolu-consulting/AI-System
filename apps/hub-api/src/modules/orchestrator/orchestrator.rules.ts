// HUB-FR-89 · Luật thuần Orchestrator (plan §6.4). Stub B0: qc viết test trước, logic ở task sau.
import type { AgentResult, OrchestratorDecision } from "@ai/contracts/hub";

export type ParseDecisionResult =
  | { ok: true; decision: OrchestratorDecision }
  | { ok: false; reason: "not_json" | "schema" };

export type BudgetState = { steps: number; maxSteps: number; tokens: number; tokenBudget: number };

export type BudgetOutcome =
  | { kind: "fail"; code: "BUDGET_EXCEEDED" }
  | { kind: "finish"; text: string };

export function parseDecision(_raw: string): ParseDecisionResult {
  throw new Error("not implemented");
}

export function budgetExceeded(_s: BudgetState): boolean {
  throw new Error("not implemented");
}

export function budgetOutcome(_answered: string | null, _locale: "vi" | "en"): BudgetOutcome {
  throw new Error("not implemented");
}

export function canPassThrough(
  _s: { delegates: number; hadPartial: boolean },
  _r: AgentResult,
): boolean {
  throw new Error("not implemented");
}

export function chunkText(_text: string, _max = 40): string[] {
  throw new Error("not implemented");
}

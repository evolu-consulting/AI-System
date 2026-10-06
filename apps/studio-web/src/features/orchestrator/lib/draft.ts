// HUB-FR-62 · H4a-R07 · bản nháp form Orchestrator (chuỗi cho ô nhập) ⇄ payload; validate bằng schema zod của contract. Hàm thuần.
import {
  type Orchestrator,
  type OrchestratorInput,
  OrchestratorInputSchema,
  type TenantItemSchema,
} from "@ai/contracts/studio";
import type { z } from "zod";

export type TenantItem = z.infer<typeof TenantItemSchema>;

export type OrchDraft = {
  agentId: string;
  maxSteps: string;
  tokenBudget: string;
  historyN: string;
  onNoMatch: OrchestratorInput["on_no_match"];
};
export type OrchField = "agent_id" | "max_steps" | "token_budget" | "history_n" | "tenant_id";
/** Giá trị = khoá i18n của câu lỗi. */
export type OrchErrors = Partial<Record<OrchField, string>>;

export const fromOrch = (o: Orchestrator): OrchDraft => ({
  agentId: o.agent.id,
  maxSteps: String(o.max_steps),
  tokenBudget: String(o.token_budget),
  historyN: String(o.history_n),
  onNoMatch: o.on_no_match,
});

export const sameDraft = (a: OrchDraft, b: OrchDraft): boolean =>
  a.agentId === b.agentId &&
  a.maxSteps === b.maxSteps &&
  a.tokenBudget === b.tokenBudget &&
  a.historyN === b.historyN &&
  a.onNoMatch === b.onNoMatch;

const num = (s: string): number => (s.trim() === "" ? Number.NaN : Number(s));

const ERR_KEY: Record<string, string> = {
  agent_id: "orch.err.agent",
  tenant_id: "orch.err.tenant",
  max_steps: "orch.err.maxSteps",
  token_budget: "orch.err.tokenBudget",
  history_n: "orch.err.historyN",
};

/** Lỗi trường theo `path[0]` (dùng cho cả zod lẫn `details.issues` của 400 VALIDATION_ERROR). */
export function mapIssues(issues: readonly { path?: unknown }[]): OrchErrors {
  const out: OrchErrors = {};
  for (const i of issues) {
    const head = Array.isArray(i.path) ? String(i.path[0]) : String(i.path ?? "");
    const key = ERR_KEY[head];
    if (key && !out[head as OrchField]) out[head as OrchField] = key;
  }
  return out;
}

export function validateDraft(d: OrchDraft): { input?: OrchestratorInput; errors: OrchErrors } {
  const r = OrchestratorInputSchema.safeParse({
    agent_id: d.agentId,
    max_steps: num(d.maxSteps),
    token_budget: num(d.tokenBudget),
    history_n: num(d.historyN),
    on_no_match: d.onNoMatch,
  });
  return r.success ? { input: r.data, errors: {} } : { errors: mapIssues(r.error.issues) };
}

export type AgentOption = { id: string; key: string; label: string; runtime: string };

type AgentLike = {
  id: string;
  key: string;
  name: { vi: string; en: string };
  runtime: string;
  enabled: boolean;
};
const option = (id: string, key: string, name: string, runtime: string): AgentOption => ({
  id,
  key,
  runtime,
  label: `${name} (${key}) · ${runtime}`,
});

/** Agent chọn được: bật + runtime ∈ ORCHESTRATOR_RUNTIMES (D12); luôn kèm agent đang được chọn. */
export function agentOptions(
  agents: readonly AgentLike[],
  runtimes: readonly string[],
  locale: "vi" | "en",
  current?: Orchestrator["agent"],
): AgentOption[] {
  const out = agents
    .filter((a) => a.enabled && runtimes.includes(a.runtime))
    .map((a) => option(a.id, a.key, a.name[locale], a.runtime));
  if (current && !out.some((o) => o.id === current.id))
    out.unshift(option(current.id, current.key, current.name, current.runtime));
  return out;
}

// HUB-FR-23 · HUB-FR-89 · H2a-R14 · `RoutingRunner` (plan H2a §5.4): chọn runner theo `agents.runtime` — `agentic-cli` →
// `JobAgentRunner` (job `agent.cli`), `dify-workflow`/`dify-agent` → `DifyAgentRunner` (Hub gọi Dify, không hàng `jobs`).
// Runner thật tiêm từ ngoài (không import `modules/dify`), nên vòng Orchestrator chỉ biết `AgentRunner`.
import type { RunEvent } from "@ai/contracts/hub";
import type { AgentRunner, AgentTask } from "./job-agent-runner";
import { syntheticFailed } from "./runner.rules";

/** Runtime agent `dify-*` chạy trong Hub (R14). */
export const DIFY_RUNTIMES: ReadonlySet<string> = new Set(["dify-workflow", "dify-agent"]);

export type RoutingRunnerDeps = {
  /** `agentic-cli` (H1). */
  job: AgentRunner;
  /** `dify-workflow`/`dify-agent`; vắng → `NOT_CONFIGURED`. */
  dify?: AgentRunner;
};

export class RoutingRunner implements AgentRunner {
  constructor(private readonly d: RoutingRunnerDeps) {}

  run(task: AgentTask, signal: AbortSignal): AsyncIterable<RunEvent> {
    if (!DIFY_RUNTIMES.has(task.agent.runtime)) return this.d.job.run(task, signal);
    if (this.d.dify) return this.d.dify.run(task, signal);
    return notConfigured(task);
  }
}

async function* notConfigured(task: AgentTask): AsyncGenerator<RunEvent> {
  const f = { code: "NOT_CONFIGURED", reason: null, message: "dify runner unavailable" } as const;
  yield syntheticFailed(task.stepId ?? crypto.randomUUID(), f);
}

// HUB-FR-23 · HUB-FR-89 · H2a-R14 · `RoutingRunner` (plan H2a §5.4): chọn runner theo `agents.runtime` — `agentic-cli` →
// `JobAgentRunner` (job `agent.cli`), `dify-workflow`/`dify-agent` → `DifyAgentRunner` (Hub gọi Dify, không hàng `jobs`).
// CR-114: `agentic-cli` mà lượt đủ điều kiện `directSdkRoute` (cờ agent, không file/tool/stage) → `DirectSdkRunner` (SDK trong Hub).
// Runner thật tiêm từ ngoài (không import `modules/dify`), nên vòng Orchestrator chỉ biết `AgentRunner`.
import type { RunEvent } from "@ai/contracts/hub";
import { agentWorkflowIds } from "../config/config.rules";
import { directSdkRoute } from "./direct/direct-sdk.rules";
import type { AgentRunner, AgentTask } from "./job/job-agent-runner";
import { packToolKeys } from "./job/pack-tool-keys.rules";
import { syntheticFailed } from "./runner.rules";

/** Runtime agent `dify-*` chạy trong Hub (R14). */
export const DIFY_RUNTIMES: ReadonlySet<string> = new Set(["dify-workflow", "dify-agent"]);

export type RoutingRunnerDeps = {
  /** `agentic-cli` (H1). */
  job: AgentRunner;
  /** `dify-workflow`/`dify-agent`; vắng → `NOT_CONFIGURED`. */
  dify?: AgentRunner;
  /** CR-114 · đường SDK trực tiếp; vắng (chưa có khoá API) ⇒ mọi lượt đi job. */
  direct?: AgentRunner;
};

/** CR-114 · lượt này đi SDK trực tiếp? (luật thuần `directSdkRoute` trên dữ kiện của task). */
export function directEligible(task: AgentTask, sdkReady: boolean): boolean {
  const a = task.agent;
  return directSdkRoute({
    runtime: a.runtime,
    runtimeOptions: a.runtimeOptions,
    sdkReady,
    fileCount: task.role === "agent" ? (task.files?.length ?? 0) : 0,
    sourceCount: task.sources?.length ?? 0,
    stage: task.stageRunId !== undefined,
    autofix: task.autofix !== undefined,
    workflowCount: task.role === "agent" ? agentWorkflowIds(task.snapshot, a.id).size : 0,
    packToolCount: task.role === "agent" ? packToolKeys(a.runtimeOptions).length : 0,
  }).ok;
}

export class RoutingRunner implements AgentRunner {
  constructor(private readonly d: RoutingRunnerDeps) {}

  run(task: AgentTask, signal: AbortSignal): AsyncIterable<RunEvent> {
    if (!DIFY_RUNTIMES.has(task.agent.runtime)) {
      if (this.d.direct && directEligible(task, true)) return this.d.direct.run(task, signal);
      return this.d.job.run(task, signal);
    }
    if (this.d.dify) return this.d.dify.run(task, signal);
    return notConfigured(task);
  }
}

async function* notConfigured(task: AgentTask): AsyncGenerator<RunEvent> {
  const f = { code: "NOT_CONFIGURED", reason: null, message: "dify runner unavailable" } as const;
  yield syntheticFailed(task.stepId ?? crypto.randomUUID(), f);
}

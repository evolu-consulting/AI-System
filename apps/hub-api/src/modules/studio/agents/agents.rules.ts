// HUB-FR-60 · HUB-FR-61 · HUB-FR-64 · H4a-R04, R05, R06, R08 · plan §4.1 · luật thuần agent Studio (QC test trước:
// `tests/acceptance/H4a/rules/agents-rules.test.ts`). Không I/O. Trùng ý mô tả định nghĩa ở `@ai/contracts/studio`.
import { ALLOWED_TOOLS } from "@ai/contracts/hub";
import type { AgentRuntime, AgentWarning } from "@ai/contracts/studio";
import { RUNNABLE_RUNTIMES } from "../../agents/agent-access.rules";

export {
  descriptionOverlap,
  descriptionTokens,
  similarAgents,
} from "@ai/contracts/studio";

export type WorkflowRef = {
  id: string;
  key: string;
  enabled: boolean;
  appType: string;
  hasDifyInput: boolean;
};
export type WorkflowProblem =
  | { reason: "not_found"; ids: string[] }
  | { reason: "disabled" | "app_type" | "no_input"; ids?: string[] };

const isDify = (rt: AgentRuntime): boolean => rt === "dify-workflow" || rt === "dify-agent";

function appTypeOk(rt: AgentRuntime, appType: string): boolean {
  if (rt === "dify-workflow") return appType === "workflow";
  if (rt === "dify-agent") return appType === "chat" || appType === "agent";
  return true;
}

/** Thứ tự: not_found → disabled → app_type → no_input → null (H4a-R04, QB3). Số lượng đã chặn ở zod. */
export function workflowProblem(
  runtime: AgentRuntime,
  wfs: readonly WorkflowRef[],
  requestedIds: readonly string[],
): WorkflowProblem | null {
  const byId = new Map(wfs.map((w) => [w.id, w]));
  const missing = requestedIds.filter((id) => !byId.has(id));
  if (missing.length > 0) return { reason: "not_found", ids: missing };
  const picked = requestedIds.map((id) => byId.get(id) as WorkflowRef);
  const ids = (f: (w: WorkflowRef) => boolean) => picked.filter(f).map((w) => w.id);
  const off = ids((w) => !w.enabled);
  if (off.length > 0) return { reason: "disabled", ids: off };
  if (!isDify(runtime)) return null;
  const badApp = ids((w) => !appTypeOk(runtime, w.appType));
  if (badApp.length > 0) return { reason: "app_type", ids: badApp };
  const noInput = ids((w) => !w.hasDifyInput);
  if (noInput.length > 0) return { reason: "no_input", ids: noInput };
  return null;
}

/** R05: chỉ khi THÊM mới `Bash` (phân biệt hoa thường). */
export function needsBashAck(before: readonly string[] | null, after: readonly string[]): boolean {
  return after.includes("Bash") && (before === null || !before.includes("Bash"));
}

export type DeleteBlocker =
  | "AGENT_IN_USE_AS_ORCHESTRATOR"
  | "AGENT_HAS_HISTORY"
  | "AGENT_HAS_ACCESS";

/** R06: Orchestrator → lịch sử → quyền (entitlement còn hiệu lực hoặc grant). */
export function deleteBlocker(x: {
  orchestratorScopes: number;
  hasHistory: boolean;
  activeEntitlements: number;
  grants: number;
}): DeleteBlocker | null {
  if (x.orchestratorScopes > 0) return "AGENT_IN_USE_AS_ORCHESTRATOR";
  if (x.hasHistory) return "AGENT_HAS_HISTORY";
  if (x.activeEntitlements > 0 || x.grants > 0) return "AGENT_HAS_ACCESS";
  return null;
}

export function disableBlocked(orchestratorScopes: number, nextEnabled: boolean): boolean {
  return !nextEnabled && orchestratorScopes > 0;
}

/** QB3/P11: `runtime_options` của dify-* do server đặt (Runtime H2a đọc `workflow_key`). */
export function difyOptions(
  runtime: AgentRuntime,
  wf: { key: string },
): { workflow_key: string } | null {
  return isDify(runtime) ? { workflow_key: wf.key } : null;
}

const NOT_READY_CLI = new Set(["codex", "gemini"]);
const RUNTIME_TOOLS: ReadonlySet<string> = new Set(ALLOWED_TOOLS);

/** `allowed_tools` của agentic-cli (mảng chuỗi), khác ⇒ []. */
export function cliTools(runtimeOptions: Record<string, unknown>): string[] {
  const t = runtimeOptions.allowed_tools;
  return Array.isArray(t) ? t.filter((x): x is string => typeof x === "string") : [];
}

/** G3/G7/QB7 — không gồm `description_overlap` (do `similarAgents`). */
export function agentWarnings(a: {
  runtime: AgentRuntime;
  runtime_options: Record<string, unknown>;
}): AgentWarning[] {
  const out: AgentWarning[] = [];
  const cli = a.runtime === "agentic-cli";
  const cliNotReady = cli && NOT_READY_CLI.has(String(a.runtime_options.cli));
  if (!RUNNABLE_RUNTIMES.has(a.runtime) || cliNotReady) out.push({ code: "runtime_not_ready" });
  if (cli) {
    const tools = cliTools(a.runtime_options).filter((t) => !RUNTIME_TOOLS.has(t));
    if (tools.length > 0) out.push({ code: "tools_not_supported", tools });
  }
  return out;
}

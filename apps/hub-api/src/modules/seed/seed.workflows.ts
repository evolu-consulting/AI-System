// HUB-FR-23, HUB-FR-89 · H2a-R14 · luật seed H2a (plan-db §4), thuần: `runtime_options` agent `dify-*`, đối chiếu
// `admin.workflows` (thiếu → bỏ dòng + cảnh báo; sai `app_type` / `difyAgentInput` = null → lỗi seed, exit 1).
import type { WorkflowInput } from "@ai/contracts";
import type { DifyAppType } from "@ai/contracts/hub";
import { difyAgentInput } from "../dify/dify.rules";
import type { SeedIssue, SeedPlan } from "./seed.rules";
import {
  DIFY_RUNTIMES,
  type DifyRuntime,
  DifyRuntimeOptionsSchema,
  type SeedAgent,
} from "./seed.schema";

/** Hàng `admin.workflows` seed cần (chỉ đọc). */
export type SeedCatalogWorkflow = {
  id: string;
  key: string;
  appType: DifyAppType;
  inputSchema: readonly WorkflowInput[];
};

export type ResolvedWorkflows = {
  agents: SeedPlan["agents"];
  agentWorkflows: { agent: string; workflowId: string }[];
  sideEffectIds: string[];
  warnings: string[];
  issues: SeedIssue[];
};

/** `dify-workflow` ↔ app `workflow`; `dify-agent` ↔ app `chat|agent`. */
export const DIFY_APP_TYPES_FOR: Record<DifyRuntime, readonly DifyAppType[]> = {
  "dify-workflow": ["workflow"],
  "dify-agent": ["chat", "agent"],
};

export const isDifyRuntime = (runtime: string): runtime is DifyRuntime =>
  (DIFY_RUNTIMES as readonly string[]).includes(runtime);

/** `workflow_key` của agent `dify-*` (đã qua `checkDifyOptions`), khác → null. */
export function difyWorkflowKey(a: Pick<SeedAgent, "runtime" | "runtime_options">): string | null {
  if (!isDifyRuntime(a.runtime)) return null;
  const k = a.runtime_options.workflow_key;
  return typeof k === "string" ? k : null;
}

/** Agent `dify-*`: `runtime_options` đúng `{workflow_key}` — thiếu/thừa khoá, key sai dạng → issue. */
export function checkDifyOptions(agents: readonly SeedAgent[], issues: SeedIssue[]): void {
  for (const a of agents) {
    if (!isDifyRuntime(a.runtime)) continue;
    const r = DifyRuntimeOptionsSchema.safeParse(a.runtime_options);
    if (r.success) continue;
    for (const i of r.error.issues)
      issues.push({
        path: `agents.${a.key}.runtime_options${i.path.length ? `.${i.path.map(String).join(".")}` : ""}`,
        message: i.message,
        value: a.runtime_options,
      });
  }
}

/** Mọi key workflow plan tham chiếu (để đọc `admin.workflows` một lần). */
export function workflowKeysOf(plan: SeedPlan): string[] {
  const keys = [
    ...plan.agents.map(difyWorkflowKey),
    ...plan.agentWorkflows.map((w) => w.workflow),
    ...plan.sideEffect,
  ];
  return [...new Set(keys.filter((k): k is string => k !== null))];
}

function checkDifyAgent(
  a: Pick<SeedAgent, "key" | "runtime">,
  wf: SeedCatalogWorkflow,
): SeedIssue | null {
  const path = `agents.${a.key}.runtime_options.workflow_key`;
  const allowed = DIFY_APP_TYPES_FOR[a.runtime as DifyRuntime];
  if (!allowed.includes(wf.appType))
    return {
      path,
      message: `workflow ${wf.key} có app_type ${wf.appType}, runtime ${a.runtime} cần ${allowed.join("|")}`,
      value: wf.key,
    };
  if (difyAgentInput(wf.inputSchema) === null)
    return {
      path,
      message: `workflow ${wf.key} không map được input nhận tin (cần input query hoặc đúng một input chuỗi bắt buộc)`,
      value: wf.key,
    };
  return null;
}

type Lookup = (key: string, what: string) => SeedCatalogWorkflow | undefined;

/** Agent không phải `dify-*` giữ nguyên; `dify-*`: workflow vắng → bỏ, sai → issue. */
function resolveAgents(plan: SeedPlan, find: Lookup, out: ResolvedWorkflows): void {
  for (const a of plan.agents) {
    const key = difyWorkflowKey(a);
    const wf = key === null ? null : find(key, `agent ${a.key}`);
    if (wf === undefined) continue;
    const issue = wf && checkDifyAgent(a, wf);
    if (issue) out.issues.push(issue);
    else out.agents.push(a);
  }
}

/**
 * Đối chiếu plan với `admin.workflows`: workflow vắng → bỏ dòng (agent `dify-*`, `agent_workflows`, `workflow_flags`) +
 * cảnh báo; agent `dify-*` sai `app_type` hoặc không map được input → `issues` (người gọi ném, không ghi gì).
 */
export function resolveWorkflows(
  plan: SeedPlan,
  catalog: readonly SeedCatalogWorkflow[],
): ResolvedWorkflows {
  const byKey = new Map(catalog.map((w) => [w.key, w]));
  const out: ResolvedWorkflows = {
    agents: [],
    agentWorkflows: [],
    sideEffectIds: [],
    warnings: [],
    issues: [],
  };
  const find: Lookup = (key, what) => {
    const wf = byKey.get(key);
    if (!wf) out.warnings.push(`seed: bỏ ${what}: workflow ${key} không có trong admin.workflows`);
    return wf;
  };
  resolveAgents(plan, find, out);
  for (const w of plan.agentWorkflows) {
    const wf = find(w.workflow, `agent_workflows ${w.agent} → ${w.workflow}`);
    if (wf) out.agentWorkflows.push({ agent: w.agent, workflowId: wf.id });
  }
  for (const k of plan.sideEffect) {
    const wf = find(k, `workflow_flags.side_effect ${k}`);
    if (wf) out.sideEffectIds.push(wf.id);
  }
  return out;
}

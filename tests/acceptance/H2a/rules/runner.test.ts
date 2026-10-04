// HUB-FR-13 · WRK-FR-07 · HUB-FR-24 · AC-W06 · H2a-R12, R13, R17, R18, P4, P10 · buildWorkflowJobPayload, mcpConfigFor,
// orphanAction (test-plan H2a §4 R60–R62, cases §1.8; chữ ký plan-rules).
import { describe, expect, it } from "bun:test";
import { HUB_CONTRACT_VERSION, McpConfigSchema, WorkflowAsyncJobSchema } from "@ai/contracts/hub";
import type { WorkflowJobInput } from "../../../../apps/hub-api/src/modules/commands/catalog.types";
import type { AgentConfig } from "../../../../apps/hub-api/src/modules/config/config.rules";
import {
  buildWorkflowJobPayload,
  mcpConfigFor,
  orphanAction,
} from "../../../../apps/hub-api/src/modules/runner/runner.rules";
import { DICH_INPUTS, uid, workflow } from "./_catalog";

const SECRET_URL = "http://dify-secret-host.test/v1";
const WF = workflow({ baseUrl: SECRET_URL, inputSchema: DICH_INPUTS, outputField: "result" });

const JOB: WorkflowJobInput = {
  jobId: uid(601),
  runId: uid(602),
  stepId: uid(603),
  tenantId: uid(604),
  userId: uid(605),
  conversationId: uid(606),
  flowId: uid(607),
  featureId: uid(608),
  commandId: uid(609),
  workflow: WF,
  inputs: { source_text: "xin chào", target_lang: "en", tone: "neutral" },
  query: null,
  outputField: "text",
  difyUser: `acme:${uid(605)}`,
  timeoutS: 120,
};

const AGENT: AgentConfig = {
  id: uid(701),
  key: "trello",
  name: { vi: "Trello", en: "Trello" },
  description: "Tạo thẻ Trello",
  runtime: "agentic-cli",
  agentTypeKey: null,
  profileId: uid(702),
  systemPrompt: "",
  runtimeOptions: {},
  timeoutS: 600,
  tokenBudget: null,
  enabled: true,
  version: 1,
};

describe("HUB-FR-13 · WRK-FR-07 · job workflow.async [R60]", () => {
  it("HUB-FR-13 · H2a-R17 · payload parse WorkflowAsyncJobSchema, không secret/URL, side_effect theo cờ [R60]", () => {
    const p = buildWorkflowJobPayload(JOB);
    expect(WorkflowAsyncJobSchema.safeParse(p).success).toBe(true);
    expect(p).toEqual({
      v: HUB_CONTRACT_VERSION,
      type: "workflow.async",
      provider_key: "dify",
      job_id: JOB.jobId,
      run_id: JOB.runId,
      step_id: JOB.stepId,
      tenant_id: JOB.tenantId,
      user_id: JOB.userId,
      conversation_id: JOB.conversationId,
      flow_id: JOB.flowId,
      workflow_id: WF.id,
      feature_id: JOB.featureId,
      command_id: JOB.commandId,
      workflow_key: "dich",
      app_type: "workflow",
      inputs: JOB.inputs,
      query: null,
      output_field: "text",
      dify_user: JOB.difyUser,
      side_effect: false,
      timeout_s: 120,
    });
    const raw = JSON.stringify(p);
    for (const leak of ["dify-secret-host", "api_key", "base_url", "token", WF.secretId ?? "-"])
      expect(raw).not.toContain(leak);
    const se = buildWorkflowJobPayload({ ...JOB, workflow: { ...WF, sideEffect: true } });
    expect(se.side_effect).toBe(true);
  });
});

describe("HUB-FR-24 · HUB-FR-50 · cấu hình MCP [R61]", () => {
  it("HUB-FR-24 · H2a-R18 · mcpConfigFor: không tool → null; có → {url, tools}, không token [R61]", () => {
    const url = "http://localhost:4000/mcp";
    expect(mcpConfigFor(AGENT, [], url)).toBeNull();
    const cfg = mcpConfigFor(AGENT, ["create-trello-card"], url);
    expect(cfg).toEqual({ url, tools: ["create-trello-card"] });
    expect(McpConfigSchema.safeParse(cfg).success).toBe(true);
  });
});

describe("AC-W06 · requeue orphan [R62]", () => {
  it("AC-W06 · H2a-R13 · orphanAction: async att 1–2 requeue, 3 fail; side_effect ∧ dispatched fail; agent.cli fail [R62]", () => {
    const wa = { type: "workflow.async", sideEffect: false, dispatched: false } as const;
    expect(orphanAction({ ...wa, attempts: 1 })).toBe("requeue");
    expect(orphanAction({ ...wa, attempts: 2 })).toBe("requeue");
    expect(orphanAction({ ...wa, attempts: 3 })).toBe("fail");
    expect(orphanAction({ ...wa, attempts: 1, dispatched: true })).toBe("requeue");
    expect(orphanAction({ ...wa, attempts: 1, sideEffect: true, dispatched: true })).toBe("fail");
    expect(orphanAction({ ...wa, attempts: 1, sideEffect: true, dispatched: false })).toBe(
      "requeue",
    );
    const cli = { type: "agent.cli", attempts: 1, sideEffect: false, dispatched: false } as const;
    expect(orphanAction(cli)).toBe("fail");
  });
});

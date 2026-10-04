import { describe, expect, test } from "bun:test";
import { CHAT_RUN_ERROR_CODES } from "../chat";
import {
  AgentCliJobSchema,
  HUB_JOB_ERROR_CODES,
  JOB_FAIL_REASONS,
  JobPayloadSchema,
  McpConfigSchema,
  RunEventSchema,
  WorkflowAsyncJobSchema,
} from "./index";

const U = "11111111-1111-4111-8111-111111111111";

const wf = {
  v: 1,
  type: "workflow.async",
  provider_key: "dify",
  job_id: U,
  run_id: U,
  step_id: U,
  tenant_id: U,
  user_id: U,
  conversation_id: U,
  flow_id: U,
  workflow_id: U,
  feature_id: null,
  command_id: U,
  workflow_key: "summarize",
  app_type: "workflow",
  inputs: { text: "a", n: 1, ok: false },
  query: null,
  output_field: "result",
  dify_user: "u",
  side_effect: false,
  timeout_s: 30,
};

describe("WRK-FR-07 · WorkflowAsyncJob", () => {
  test("WRK-FR-07 · JobPayload nhận workflow.async", () => {
    expect(JobPayloadSchema.parse(wf)).toEqual(wf as never);
  });

  test("WRK-FR-07 · từ chối secret/URL trong payload, key sai, vượt biên", () => {
    const bad = (patch: Record<string, unknown>) =>
      WorkflowAsyncJobSchema.safeParse({ ...wf, ...patch }).success;
    for (const extra of ["base_url", "api_key", "token", "hub_url"]) {
      expect(bad({ [extra]: "x" })).toBe(false);
    }
    expect(bad({ provider_key: "claude-code" })).toBe(false);
    expect(bad({ workflow_key: "A" })).toBe(false);
    expect(bad({ workflow_key: "x".repeat(33) })).toBe(false);
    expect(bad({ app_type: "completion" })).toBe(false);
    expect(bad({ inputs: { "1x": "a" } })).toBe(false);
    expect(bad({ inputs: { a: "x".repeat(64_001) } })).toBe(false);
    expect(bad({ inputs: { a: null } })).toBe(false);
    expect(bad({ query: "" })).toBe(false);
    expect(bad({ output_field: "x".repeat(129) })).toBe(false);
    expect(bad({ dify_user: "" })).toBe(false);
    expect(bad({ timeout_s: 0 })).toBe(false);
    expect(bad({ timeout_s: 601 })).toBe(false);
    expect(bad({ timeout_s: 600, query: "q", app_type: "chat" })).toBe(true);
  });
});

describe("HUB-FR-89 · mcp, mã, lý do", () => {
  test("HUB-FR-89 · agent.cli mcp = {url, tools 1–20} hoặc null", () => {
    const mcp = { url: "https://hub/mcp", tools: ["summarize"] };
    expect(McpConfigSchema.parse(mcp)).toEqual(mcp);
    expect(McpConfigSchema.safeParse({ ...mcp, tools: [] }).success).toBe(false);
    expect(McpConfigSchema.safeParse({ ...mcp, tools: Array(21).fill("ab") }).success).toBe(false);
    expect(McpConfigSchema.safeParse({ ...mcp, url: "ws://hub" }).success).toBe(false);
    expect(McpConfigSchema.safeParse({ ...mcp, token: "t" }).success).toBe(false);
    expect(AgentCliJobSchema.shape.mcp.safeParse(null).success).toBe(true);
  });

  test("HUB-FR-89 · NOT_CONFIGURED ⊂ chat, lý do credential/upstream trong job.failed", () => {
    const chat: readonly string[] = CHAT_RUN_ERROR_CODES;
    expect(HUB_JOB_ERROR_CODES).toContain("NOT_CONFIGURED");
    for (const code of HUB_JOB_ERROR_CODES) expect(chat).toContain(code);
    expect(JOB_FAIL_REASONS).toEqual(expect.arrayContaining(["credential", "upstream"]));
    const failed = {
      v: 1,
      job_id: U,
      seq: 2,
      at: "2026-10-05T08:00:00.000+07:00",
      type: "job.failed",
      status: "failed",
      code: "NOT_CONFIGURED",
      reason: "credential",
      message: "x",
      usage: { input_tokens: 0, output_tokens: 0 },
    };
    expect(RunEventSchema.safeParse(failed).success).toBe(true);
  });
});

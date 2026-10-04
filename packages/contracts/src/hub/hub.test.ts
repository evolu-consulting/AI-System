import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { AskSchema, CHAT_RUN_ERROR_CODES } from "../chat";
import {
  AgentCliJobSchema,
  AgentResultSchema,
  AgentTypeManifestSchema,
  HUB_JOB_ERROR_CODES,
  HUB_JSON_SCHEMAS,
  HubConfigChangedPayloadSchema,
  JobCancelPayloadSchema,
  JobEnqueuedPayloadSchema,
  JobPayloadSchema,
  OrchestratorDecisionSchema,
  RunEventSchema,
  runStreamKey,
  sseStreamKey,
} from "./index";

const U = "11111111-1111-4111-8111-111111111111";
const T = "2026-10-04T08:00:00.000+07:00";
const usage = { input_tokens: 10, output_tokens: 0 };

const job = {
  v: 1,
  type: "agent.cli",
  runtime: "agentic-cli",
  job_id: U,
  run_id: U,
  step_id: U,
  tenant_id: U,
  user_id: U,
  conversation_id: U,
  flow_id: U,
  feature_id: null,
  agent_type_key: null,
  mcp: null,
  agent: { id: U, key: "orchestrator", role: "orchestrator" },
  provider_key: "claude-code",
  model: null,
  step_index: 0,
  max_turns: 3,
  profile_steps: [{ provider_key: "claude-code", model: null, on: [] }],
  system_prompt: "",
  prompt: "xin chào",
  history: [{ role: "user", content: "" }],
  use_session: false,
  allowed_tools: [],
  output: "text",
  timeout_s: 600,
};

describe("HUB-FR-89 · JobPayload", () => {
  test("HUB-FR-89 · nhận payload hợp lệ", () => {
    expect(JobPayloadSchema.parse(job)).toEqual(job as never);
  });

  test("HUB-FR-89 · từ chối trường lạ, key sai, vượt biên", () => {
    const bad = (patch: Record<string, unknown>) =>
      AgentCliJobSchema.safeParse({ ...job, ...patch }).success;
    expect(bad({ extra: 1 })).toBe(false);
    expect(bad({ v: 2 })).toBe(false);
    expect(bad({ provider_key: "Claude" })).toBe(false);
    expect(bad({ provider_key: "a" })).toBe(false);
    expect(bad({ mcp: {} })).toBe(false);
    expect(bad({ step_index: 5 })).toBe(false);
    expect(bad({ max_turns: 0 })).toBe(false);
    expect(bad({ profile_steps: [] })).toBe(false);
    expect(bad({ prompt: "" })).toBe(false);
    expect(bad({ allowed_tools: ["Write"] })).toBe(false);
    expect(bad({ timeout_s: 9 })).toBe(false);
  });
});

describe("HUB-FR-89 · RunEvent", () => {
  const base = { v: 1, job_id: U, seq: 1, at: T };

  test("HUB-FR-89 · nhận đủ 4 loại", () => {
    const events = [
      { ...base, type: "job.started", worker_id: "w-1", provider_key: "claude-code" },
      { ...base, type: "job.progress", message: "đang đọc", percent: null },
      {
        ...base,
        type: "job.result",
        output: { kind: "agent_result", result: { status: "done", text: "ok" } },
        usage,
        session_resumed: true,
      },
      {
        ...base,
        type: "job.failed",
        status: "timed_out",
        code: "TIMEOUT",
        reason: "timeout",
        message: "quá giờ",
        usage,
      },
    ];
    for (const e of events) expect(RunEventSchema.parse(e)).toEqual(e as never);
  });

  test("HUB-FR-89 · từ chối seq 0, at không offset, code ngoài tập", () => {
    const failed = {
      ...base,
      type: "job.failed",
      status: "failed",
      reason: null,
      message: "x",
      usage,
    };
    expect(RunEventSchema.safeParse({ ...failed, code: "BUDGET_EXCEEDED" }).success).toBe(false);
    expect(RunEventSchema.safeParse({ ...failed, code: "TIMEOUT", seq: 0 }).success).toBe(false);
    expect(
      RunEventSchema.safeParse({ ...failed, code: "TIMEOUT", at: "2026-10-04 08:00" }).success,
    ).toBe(false);
  });
});

describe("HUB-FR-27 · AgentResult · OrchestratorDecision", () => {
  test("HUB-FR-27 · need_input cùng dạng AskSchema chat", () => {
    const ask = { question: "Chọn?", choices: ["A", "B"] };
    expect(AgentResultSchema.parse({ status: "need_input", ...ask })).toEqual({
      status: "need_input",
      ...ask,
    });
    expect(AskSchema.parse(ask)).toEqual(ask);
    expect(
      AgentResultSchema.safeParse({ status: "need_input", question: "?", choices: ["", "x"] })
        .success,
    ).toBe(false);
    expect(AgentResultSchema.safeParse({ status: "partial", text: "a", missing: "" }).success).toBe(
      false,
    );
  });

  test("HUB-FR-27 · decision delegate/answer/ask", () => {
    expect(
      OrchestratorDecisionSchema.safeParse({ decision: "delegate", agent: "coder", task: "x" })
        .success,
    ).toBe(true);
    expect(OrchestratorDecisionSchema.safeParse({ decision: "answer", text: "" }).success).toBe(
      false,
    );
    expect(
      OrchestratorDecisionSchema.safeParse({
        decision: "ask",
        question: "?",
        choices: Array(7).fill("a"),
      }).success,
    ).toBe(false);
  });
});

describe("HUB-FR-89 · manifest, NOTIFY, mã", () => {
  test("HUB-FR-89 · HUB_JOB_ERROR_CODES ⊂ CHAT_RUN_ERROR_CODES", () => {
    const chat: readonly string[] = CHAT_RUN_ERROR_CODES;
    for (const code of HUB_JOB_ERROR_CODES) expect(chat).toContain(code);
  });

  test("HUB-FR-89 · manifest và payload NOTIFY", () => {
    const m = {
      key: "repo-reader",
      runtime: "agentic-cli",
      description: { vi: "Đọc repo", en: "Read repo" },
      config_schema: { type: "object" },
      version: 1,
    };
    expect(AgentTypeManifestSchema.parse(m)).toEqual(m as never);
    expect(AgentTypeManifestSchema.safeParse({ ...m, description: { vi: "x" } }).success).toBe(
      false,
    );
    expect(
      JobEnqueuedPayloadSchema.safeParse({ v: 1, job_id: U, provider_key: "claude-code" }).success,
    ).toBe(true);
    expect(JobCancelPayloadSchema.safeParse({ v: 1, job_id: U }).success).toBe(false);
    expect(HubConfigChangedPayloadSchema.safeParse({ v: 1, version: 0 }).success).toBe(false);
    expect(runStreamKey(U)).toBe(`run:${U}`);
    expect(sseStreamKey(U)).toBe(`sse:${U}`);
  });

  test("HUB-FR-89 · z.toJSONSchema không ném với mọi schema xuất", () => {
    expect(Object.keys(HUB_JSON_SCHEMAS)).toHaveLength(8);
    for (const s of Object.values(HUB_JSON_SCHEMAS)) {
      expect(() => z.toJSONSchema(s, { unrepresentable: "throw" })).not.toThrow();
      expect(() =>
        z.toJSONSchema(s, { target: "draft-2020-12", io: "output", unrepresentable: "throw" }),
      ).not.toThrow();
    }
  });
});

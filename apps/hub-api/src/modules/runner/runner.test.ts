// HUB-FR-89 · HUB-BR-03 · H1-R18, R21 · P7 · luật thuần AgentRunner (`runner.rules.ts`).
import { describe, expect, it } from "bun:test";
import { RunEventSchema } from "@ai/contracts/hub";
import type { AgentConfig, ProfileConfig } from "../config/config.rules";
import {
  buildJobPayload,
  compareStreamId,
  eventFromJobRow,
  type PayloadInput,
  providerBlocked,
  syntheticFailed,
  ZERO_USAGE,
} from "./runner.rules";

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const agent = (o: Partial<AgentConfig> = {}): AgentConfig => ({
  id: U(1),
  key: "assistant",
  name: { vi: "a", en: "a" },
  description: "",
  runtime: "agentic-cli",
  agentTypeKey: null,
  profileId: U(9),
  systemPrompt: "SP",
  runtimeOptions: {},
  timeoutS: 600,
  tokenBudget: null,
  enabled: true,
  version: 1,
  ...o,
});
const profile: ProfileConfig = {
  id: U(9),
  key: "fake-1",
  steps: [{ provider_key: "fake-cli", model: null, on: ["quota", "lạ"] }],
};
const input = (o: Partial<PayloadInput> = {}): PayloadInput => ({
  jobId: U(2),
  stepId: U(3),
  run: { id: U(4), tenantId: U(5), userId: U(6), conversationId: U(7), flowId: U(8) },
  agent: agent(),
  role: "agent",
  profile,
  prompt: "Việc",
  systemPrompt: "SP",
  history: [{ role: "user", content: "trước" }],
  ...o,
});

describe("HUB-FR-89 · buildJobPayload (plan §2.2)", () => {
  it("HUB-BR-03 · agent mặc định: Read+Grep, max_turns 30, use_session, agent_result, bước 0", () => {
    const p = buildJobPayload(input());
    expect(p).toMatchObject({
      type: "agent.cli",
      runtime: "agentic-cli",
      job_id: U(2),
      step_id: U(3),
      run_id: U(4),
      agent: { id: U(1), key: "assistant", role: "agent" },
      provider_key: "fake-cli",
      model: null,
      step_index: 0,
      max_turns: 30,
      allowed_tools: ["Read", "Grep"],
      use_session: true,
      output: "agent_result",
      timeout_s: 600,
      feature_id: null,
      agent_type_key: null,
      mcp: null,
      profile_steps: [{ provider_key: "fake-cli", model: null, on: ["quota"] }],
      history: [{ role: "user", content: "trước" }],
    });
  });

  it("H1-R21 · runtime_options áp, tool ngoài {Read,Grep,Glob} bị bỏ", () => {
    const a = agent({ runtimeOptions: { allowed_tools: ["Glob", "Bash"], max_turns: 7 } });
    const p = buildJobPayload(input({ agent: a }));
    expect(p?.allowed_tools).toEqual(["Glob"]);
    expect(p?.max_turns).toBe(7);
  });

  it("HUB-FR-89 · Orchestrator: max_turns 3, không tool, không session, output text", () => {
    const p = buildJobPayload(input({ role: "orchestrator" }));
    expect(p).toMatchObject({
      max_turns: 3,
      allowed_tools: [],
      use_session: false,
      output: "text",
    });
  });

  it("HUB-FR-89 · sai contract (timeout_s ngoài 10–3600, profile rỗng) → null", () => {
    expect(buildJobPayload(input({ agent: agent({ timeoutS: 5 }) }))).toBeNull();
    expect(buildJobPayload(input({ profile: { ...profile, steps: [] } }))).toBeNull();
  });
});

describe("H1-R18 · providerBlocked", () => {
  const now = new Date("2026-10-04T00:00:00Z");
  it("H1-R18 · cooldown chưa hết / không giờ hết / logged_out / error → chặn", () => {
    expect(
      providerBlocked({ status: "cooldown", cooldownUntil: new Date("2099-01-01") }, now),
    ).toBe(true);
    expect(providerBlocked({ status: "cooldown", cooldownUntil: null }, now)).toBe(true);
    expect(providerBlocked({ status: "logged_out", cooldownUntil: null }, now)).toBe(true);
    expect(providerBlocked({ status: "error", cooldownUntil: null }, now)).toBe(true);
  });
  it("H1-R18 · vắng / ok / busy / cooldown đã qua → không chặn", () => {
    expect(providerBlocked(undefined, now)).toBe(false);
    expect(providerBlocked({ status: "ok", cooldownUntil: null }, now)).toBe(false);
    expect(providerBlocked({ status: "busy", cooldownUntil: null }, now)).toBe(false);
    expect(
      providerBlocked({ status: "cooldown", cooldownUntil: new Date("2000-01-01") }, now),
    ).toBe(false);
  });
});

const row = { result: null, errorCode: null, errorReason: null, errorMessage: null };
const usage = { input_tokens: 3, output_tokens: 4 };

describe("P7 · eventFromJobRow (dựng từ DB)", () => {
  it("HUB-FR-89 · succeeded + JobOutput → job.result hợp contract", () => {
    const ev = eventFromJobRow(
      U(2),
      { ...row, status: "succeeded", result: { kind: "text", text: "x" } },
      usage,
    );
    expect(RunEventSchema.safeParse(ev).success).toBe(true);
    expect(ev).toMatchObject({ type: "job.result", output: { kind: "text", text: "x" }, usage });
  });
  it("HUB-FR-89 · succeeded nhưng result sai → job.failed UPSTREAM_ERROR invalid_output", () => {
    const ev = eventFromJobRow(U(2), { ...row, status: "succeeded", result: { kind: "?" } }, usage);
    expect(ev).toMatchObject({
      type: "job.failed",
      code: "UPSTREAM_ERROR",
      reason: "invalid_output",
    });
  });
  it("HUB-FR-89 · failed/cancelled/timed_out → job.failed (mã lạ/vắng theo trạng thái)", () => {
    const f = eventFromJobRow(
      U(2),
      {
        ...row,
        status: "failed",
        errorCode: "ALL_PROVIDERS_EXHAUSTED",
        errorReason: "tenant_slots",
      },
      ZERO_USAGE,
    );
    expect(RunEventSchema.safeParse(f).success).toBe(true);
    expect(f).toMatchObject({ code: "ALL_PROVIDERS_EXHAUSTED", reason: "tenant_slots" });
    expect(eventFromJobRow(U(2), { ...row, status: "cancelled" }, ZERO_USAGE)).toMatchObject({
      status: "cancelled",
      code: "CANCELLED",
    });
    expect(
      eventFromJobRow(U(2), { ...row, status: "timed_out", errorReason: "x" }, ZERO_USAGE),
    ).toMatchObject({ code: "TIMEOUT", reason: null });
  });
});
describe("P7 · eventFromJobRow — chưa kết thúc, sự kiện tự dựng", () => {
  it("P7 · queued/running → null", () => {
    expect(eventFromJobRow(U(2), { ...row, status: "queued" }, ZERO_USAGE)).toBeNull();
    expect(eventFromJobRow(U(2), { ...row, status: "running" }, ZERO_USAGE)).toBeNull();
  });
  it("HUB-FR-89 · syntheticFailed cắt message 500, hợp contract", () => {
    const ev = syntheticFailed(U(2), {
      code: "INTERNAL_ERROR",
      reason: null,
      message: "x".repeat(900),
    });
    expect(ev.message.length).toBe(500);
    expect(RunEventSchema.safeParse(ev).success).toBe(true);
  });
});

describe("HUB-FR-89 · compareStreamId", () => {
  it("HUB-FR-89 · so theo ms rồi seq (không theo chuỗi)", () => {
    expect(compareStreamId("9-0", "10-0")).toBe(-1);
    expect(compareStreamId("10-2", "10-10")).toBe(-1);
    expect(compareStreamId("10-0", "10-0")).toBe(0);
    expect(compareStreamId("11-0", "0-0")).toBe(1);
  });
});

describe("HUB-FR-31 · HUB-FR-32 · bước profile → job Runtime (H1-R18: chỉ bước đầu)", () => {
  const twoSteps: ProfileConfig = {
    ...profile,
    steps: [
      { provider_key: "claude-sub", model: "sonnet", on: ["error", "timeout", "lạ"] },
      { provider_key: "fake-cli", model: null, on: [] },
    ],
  };

  it("HUB-FR-31 · profile nhiều bước: job phục vụ bằng bước 0, profile_steps chỉ bước đó, trigger lạ bị bỏ", () => {
    const p = buildJobPayload(input({ profile: twoSteps }));
    expect(p?.step_index).toBe(0);
    expect(p?.profile_steps).toEqual([
      { provider_key: "claude-sub", model: "sonnet", on: ["error", "timeout"] },
    ]);
  });

  it("HUB-FR-32 · bước subscription của agent agentic-cli → job agent.cli cho Runtime, provider/model theo bước", () => {
    const p = buildJobPayload(input({ profile: twoSteps }));
    expect(p).toMatchObject({
      type: "agent.cli",
      runtime: "agentic-cli",
      provider_key: "claude-sub",
      model: "sonnet",
    });
  });
});

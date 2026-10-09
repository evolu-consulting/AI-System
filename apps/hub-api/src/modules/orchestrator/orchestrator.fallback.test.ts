// CR-054 · agent dự phòng là điểm cuối: `partial` của nó kết thúc run, không quay lại Orchestrator (UAT 2026-10-09: chạy đôi).
import { describe, expect, it } from "bun:test";
import type { AgentResult, JobOutput, TokenUsage } from "@ai/contracts/hub";
import { accessInput, visibleAgents } from "../agents/agent-access.rules";
import type { NoMatchPolicy } from "../agents/default-agent.rules";
import type { AgentConfig } from "../config/config.rules";
import { type LoopInput, type LoopJob, runLoop } from "./orchestrator.loop";

const T = "00000000-0000-4000-8000-000000000001";
const U = "00000000-0000-4000-8000-000000000002";
const agent = (id: string, key: string): AgentConfig => ({
  id,
  key,
  name: { vi: key, en: key },
  description: `mô tả ${key}`,
  runtime: "agentic-cli",
  agentTypeKey: null,
  profileId: "p",
  systemPrompt: `sys ${key}`,
  runtimeOptions: {},
  timeoutS: 60,
  tokenBudget: null,
  enabled: true,
  version: 1,
});
const ORCH = agent("o", "orchestrator");
const CONSULT = agent("c", "consultant");
const INVOICES = agent("i", "invoices");
const AGENTS = [ORCH, CONSULT, INVOICES];

function input(noMatch?: NoMatchPolicy): LoopInput {
  const access = accessInput(
    {
      agents: AGENTS,
      entitlements: AGENTS.map((a) => ({ agentId: a.id, tenantId: T, revokedAt: null })),
      grants: [CONSULT, INVOICES].map((a) => ({ agentId: a.id, tenantId: T, subject: U })),
      orchestrator: { agentId: ORCH.id },
    },
    { tenantId: T, userId: U, groupIds: new Set() },
  );
  const visible = visibleAgents(access);
  return {
    ...(noMatch && { noMatch }),
    orchestrator: ORCH,
    agents: AGENTS,
    settings: { maxSteps: 5, tokenBudget: 200_000 },
    access,
    visible,
    hint: { last_agent: null, waiting_for: null },
    history: [],
    message: "Công ty mình có quy định nghỉ phép thế nào?",
    locale: "vi",
  };
}

const USAGE: TokenUsage = { input_tokens: 10, output_tokens: 5 };
const delegateTo = (key: string): JobOutput => ({
  kind: "text",
  text: JSON.stringify({ decision: "delegate", agent: key, task: "việc" }),
});
const PARTIAL: AgentResult = { status: "partial", text: "CHUA-CO-TAI-LIEU", missing: "nội quy" };

function run(c: LoopInput, delegateKey: string) {
  const jobs: LoopJob[] = [];
  const out = runLoop(
    {
      job: async (j) => {
        jobs.push(j);
        const output: JobOutput =
          j.role === "orchestrator"
            ? delegateTo(delegateKey)
            : { kind: "agent_result", result: PARTIAL };
        return { kind: "result", output, usage: USAGE };
      },
      skip: async () => {},
    },
    c,
  );
  return { out, jobs };
}

describe("CR-054 · agent dự phòng partial → kết thúc, không chạy đôi [HUB-FR-77]", () => {
  const fallback = (): NoMatchPolicy => {
    const ref = input().visible.find((v) => v.key === "consultant");
    if (!ref) throw new Error("thiếu consultant");
    return { kind: "fallback", agent: ref };
  };

  it("dự phòng trả partial → run xong với phần đã làm, gắn agent dự phòng; chỉ 2 job", async () => {
    const r = run(input(fallback()), "consultant");
    expect(await r.out).toEqual({ kind: "text", text: "CHUA-CO-TAI-LIEU", agentId: CONSULT.id });
    expect(r.jobs.map((j) => j.role)).toEqual(["orchestrator", "agent"]);
  });

  it("agent chuyên môn (không phải dự phòng) partial → vẫn quay lại Orchestrator như H1-R07", async () => {
    const r = run(input(fallback()), "invoices");
    await r.out;
    expect(r.jobs.length).toBeGreaterThan(2);
    expect(r.jobs[2]?.role).toBe("orchestrator");
  });

  it("không có chính sách dự phòng → hành vi H1 giữ nguyên", async () => {
    const r = run(input(), "consultant");
    await r.out;
    expect(r.jobs[2]?.role).toBe("orchestrator");
  });
});

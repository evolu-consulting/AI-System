// CR-114 hub-fast-sdk · `DirectSdkRunner` với SDK giả + bước giả: delta → job.result (usage gồm token cache), bước đóng `ok`;
// Orchestrator không stream; bucket hết ⇒ job.failed provider_busy (không mở bước); routing theo cờ agent.
import { describe, expect, it } from "bun:test";
import type { RunEvent } from "@ai/contracts/hub";
import type { TurnStreamer } from "../../../lib/ai-client/anthropic.provider";
import { logger } from "../../../lib/logger";
import { DeltaSink } from "../../stream/delta-sink";
import type { AgentTask } from "../job/job-agent-runner";
import { directEligible, RoutingRunner } from "../routing-runner";
import { DirectSdkRunner, type DirectSteps } from "./direct-sdk-runner";

const usage = { inputTokens: 10, outputTokens: 5, cacheReadTokens: 100, cacheWriteTokens: 7 };
const sdk: TurnStreamer = async (r) => {
  r.onText?.("Xin ");
  r.onText?.("chào");
  return { ok: true, text: "Xin chào", model: r.model, usage };
};

function fakeSteps() {
  const log: { op: string; v: unknown }[] = [];
  const steps: DirectSteps = {
    open: async (s) => {
      log.push({ op: "open", v: s });
      return 3;
    },
    close: async (p) => {
      log.push({ op: "close", v: p });
      return { startedAt: new Date(0), finishedAt: new Date(12) };
    },
  };
  return { steps, log };
}

function task(
  o: Partial<AgentTask> & { runtimeOptions?: Record<string, unknown> } = {},
): AgentTask {
  return {
    run: { id: crypto.randomUUID(), tenantId: "t1", userId: "u1", locale: "vi" },
    snapshot: { agents: [], workflows: [], agentWorkflows: new Map() },
    agent: {
      id: "a1",
      key: "assistant",
      runtime: "agentic-cli",
      runtimeOptions: o.runtimeOptions ?? { direct_sdk: true },
      systemPrompt: "s",
      timeoutS: 30,
      name: { vi: "x", en: "x" },
    },
    role: "agent",
    prompt: "q",
    history: [],
    ...o,
  } as unknown as AgentTask;
}

async function collect(it: AsyncIterable<RunEvent>): Promise<RunEvent[]> {
  const out: RunEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

describe("CR-114 · direct-sdk runner", () => {
  it("direct-sdk runner streams deltas and result", async () => {
    const { steps, log } = fakeSteps();
    const r = new DirectSdkRunner({ steps, stream: sdk, log: logger });
    const sink = new DeltaSink(["done"], async () => {});
    const evs = await collect(r.run(task({ stream: sink }), new AbortController().signal));
    expect(evs.map((e) => e.type)).toEqual(["job.started", "job.delta", "job.delta", "job.result"]);
    expect(evs.map((e) => e.seq)).toEqual([1, 2, 3, 4]);
    const end = evs.at(-1) as Extract<RunEvent, { type: "job.result" }>;
    expect(end.usage).toEqual({ input_tokens: 117, output_tokens: 5 });
    expect(end.output).toEqual({
      kind: "agent_result",
      result: { status: "done", text: "Xin chào" },
    });
    const close = log.find((l) => l.op === "close")?.v as {
      status: string;
      detail: { usage: object };
    };
    expect(close.status).toBe("ok");
    expect(close.detail.usage).toMatchObject({
      cache_read_input_tokens: 100,
      cache_creation_input_tokens: 7,
    });
  });

  it("orchestrator gets text output without deltas", async () => {
    const { steps, log } = fakeSteps();
    const r = new DirectSdkRunner({ steps, stream: sdk, log: logger });
    const sink = new DeltaSink(["answer"], async () => {});
    const evs = await collect(
      r.run(task({ role: "orchestrator", stream: sink }), new AbortController().signal),
    );
    expect(evs.map((e) => e.type)).toEqual(["job.started", "job.result"]);
    expect(log[0]?.v).toMatchObject({ type: "orchestrator" });
  });

  it("rate-limited ⇒ provider_busy, no step opened", async () => {
    const { steps, log } = fakeSteps();
    const rate = { take: async () => ({ ok: false as const, retryMs: 500 }) };
    const r = new DirectSdkRunner({ steps, stream: sdk, log: logger, rate });
    const evs = await collect(r.run(task(), new AbortController().signal));
    expect(evs).toHaveLength(1);
    expect(evs[0]).toMatchObject({
      type: "job.failed",
      code: "ALL_PROVIDERS_EXHAUSTED",
      reason: "provider_busy",
    });
    expect(log).toHaveLength(0);
  });

  it("routing picks direct only when eligible", async () => {
    const tag = (t: string) => ({
      run: async function* () {
        yield { type: t } as unknown as RunEvent;
      },
    });
    const rr = new RoutingRunner({ job: tag("job"), direct: tag("direct") });
    const sig = new AbortController().signal;
    expect((await collect(rr.run(task(), sig)))[0]?.type as string).toBe("direct");
    expect((await collect(rr.run(task({ runtimeOptions: {} }), sig)))[0]?.type as string).toBe(
      "job",
    );
    const withFiles = task({ files: [{}] as unknown as AgentTask["files"] });
    expect(directEligible(withFiles, true)).toBe(false);
    expect((await collect(rr.run(withFiles, sig)))[0]?.type as string).toBe("job");
  });
});

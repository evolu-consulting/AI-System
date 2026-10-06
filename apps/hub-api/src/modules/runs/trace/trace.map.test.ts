// HUB-FR-52 · H3b-R18, R49 · `toRunTrace`: usage gắn step + dòng tổng, cắt 200 + truncated, che `detail` theo view.
import { describe, expect, it } from "bun:test";
import { MASK, RunTraceSchema } from "@ai/contracts/hub-admin";
import { type TraceRows, toRunTrace } from "./trace.map";
import type { TraceStepRow } from "./trace.repo";

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const T0 = new Date("2026-10-06T08:00:00.000Z");
const step = (seq: number, detail: unknown = null): TraceStepRow => ({
  id: U(100 + seq),
  seq,
  type: "delegate",
  agentId: U(9),
  agentKey: "hoadon",
  workflowId: null,
  providerKey: "fake-cli",
  jobId: null,
  labelKey: "step.delegate",
  status: "ok",
  detail,
  startedAt: T0,
  finishedAt: new Date(T0.getTime() + 50),
});
const base = (steps: TraceStepRow[]): TraceRows => ({
  run: {
    id: U(1),
    tenantId: U(2),
    userId: U(3),
    kind: "orchestrated",
    status: "finished",
    errorCode: null,
    errorMessage: null,
    configVersion: 1,
    conversationId: U(4),
    flowId: U(5),
    userMessageId: U(6),
    answerMessageId: null,
    tokensUsed: 0,
    startedAt: T0,
    finishedAt: null,
  },
  steps,
  jobs: [],
  usage: [
    {
      stepId: U(101),
      total: false,
      model: "haiku",
      inputTokens: 1,
      outputTokens: 2,
      costUsd: "0.1",
      billableUsd: null,
    },
    {
      stepId: null,
      total: true,
      model: "haiku",
      inputTokens: 3,
      outputTokens: 4,
      costUsd: null,
      billableUsd: null,
    },
  ],
  messages: [{ id: U(6), content: "hi", createdAt: T0 }],
});

describe("HUB-FR-52 · toRunTrace", () => {
  it("HUB-FR-52 · usage theo step + tổng (model null), ms, messages, hợp contract", () => {
    const t = RunTraceSchema.parse(toRunTrace(base([step(1), step(2)]), "own"));
    expect(t.steps.map((s) => [s.ms, s.usage?.input_tokens ?? null])).toEqual([
      [50, 1],
      [50, null],
    ]);
    expect(t.usage_total).toEqual({
      model: null,
      input_tokens: 3,
      output_tokens: 4,
      cost_usd: null,
      billable_usd: null,
    });
    expect([t.messages.user?.content, t.messages.answer, t.truncated]).toEqual(["hi", null, false]);
  });

  it("HUB-FR-52 · 201 step ⇒ 200 + truncated", () => {
    const steps = Array.from({ length: 201 }, (_, i) => step(i + 1));
    const t = toRunTrace(base(steps), "platform");
    expect([t.steps.length, t.truncated]).toEqual([200, true]);
  });

  it("H3b-R49 · own bỏ message/upstream, platform giữ; khoá nhạy cảm ⇒ MASK", () => {
    const d = { message: "m", upstream: "u", api_key: "x" };
    expect(toRunTrace(base([step(1, d)]), "own").steps[0]?.detail).toEqual({ api_key: MASK });
    expect(toRunTrace(base([step(1, d)]), "platform").steps[0]?.detail).toEqual({
      ...d,
      api_key: MASK,
    });
  });
});

// HUB-FR-106 · HUB-FR-146 · P-d2 T19s · `settleStep` qua `StepRepo` giả: ba nhánh join + số lời gọi ghi (không DB).
import { describe, expect, it } from "bun:test";
import type { StageRunStatus } from "../../domain/types";
import type { StepJoinLoad, StepRepo } from "../ports";
import { settleStep } from "./settle-step.usecase";

function fake(load: StepJoinLoad | null) {
  const calls: unknown[][] = [];
  const steps: StepRepo = {
    loadJoin: async () => load,
    queueStep: async (runId, q) => void calls.push(["queueStep", runId, q]),
    finish: async (runId, first) => void calls.push(["finish", runId, first]),
    setStatus: async (runId, status, first) => void calls.push(["setStatus", runId, status, first]),
  };
  return { r: { steps }, calls };
}
const join = (
  step: number,
  steps: number[],
  st: StageRunStatus[],
  kinds: (string | undefined)[] = [],
): StepJoinLoad => ({
  step,
  steps,
  statuses: new Map(st.map((s, i) => [i, s] as const)),
  executorKinds: kinds,
});

describe("HUB-FR-106 · T19s · settleStep (use case)", () => {
  it("không thấy run ⇒ null, không ghi", async () => {
    const f = fake(null);
    expect(await settleStep(f.r, "r1")).toBeNull();
    expect(f.calls).toEqual([]);
  });
  it("bước xong, còn bước kế ⇒ queueStep(stage của bước kế) + next_step", async () => {
    const f = fake(join(0, [0, 1, 1, 2], ["done", "pending", "pending", "pending"]));
    expect(await settleStep(f.r, "r1")).toEqual({
      kind: "next_step",
      status: "running",
      step: 1,
      stageIdx: 1,
    });
    expect(f.calls).toEqual([["queueStep", "r1", { idxs: [1, 2], step: 1, first: 1 }]]);
  });
  it("bước cuối xong (kể cả skipped) ⇒ finish", async () => {
    const f = fake(join(1, [0, 1, 1], ["done", "done", "skipped"]));
    expect(await settleStep(f.r, "r1")).toEqual({
      kind: "finish",
      status: "done",
      step: 1,
      stageIdx: 1,
    });
    expect(f.calls).toEqual([["finish", "r1", 1]]);
  });
  it("PD-R15 · chờ hẹn retry ⇒ running; chờ wait_until ⇒ waiting_timer", async () => {
    const retry = fake(join(0, [0, 0], ["waiting_timer", "done"], ["agent", "agent"]));
    expect((await settleStep(retry.r, "r1"))?.status).toBe("running");
    expect(retry.calls).toEqual([["setStatus", "r1", "running", 0]]);
    const wait = fake(join(0, [0, 0], ["waiting_timer", "done"], ["wait_until", "agent"]));
    expect(await settleStep(wait.r, "r1")).toEqual({
      kind: "wait",
      status: "waiting_timer",
      step: 0,
      stageIdx: 0,
    });
  });
});

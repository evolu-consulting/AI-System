// HUB-FR-106 · HUB-FR-146 · P-d2 T19s · `settleStep` qua `StepRepo` giả: ba nhánh join + số lời gọi ghi (không DB).
import { describe, expect, it } from "bun:test";
import type { BranchRule } from "../../domain/branch/branch-def.rules";
import type { StageRunStatus } from "../../domain/types";
import type { StepJoinLoad, StepRepo } from "../ports";
import { settleStep } from "./settle-step.usecase";

function fake(load: StepJoinLoad | null, fields: Record<string, string | number> | null = null) {
  const calls: unknown[][] = [];
  const steps: StepRepo = {
    loadJoin: async () => load,
    queueStep: async (runId, q) => void calls.push(["queueStep", runId, q]),
    finish: async (runId, first) => void calls.push(["finish", runId, first]),
    setStatus: async (runId, status, first) => void calls.push(["setStatus", runId, status, first]),
    currentFields: async (runId, idx) => {
      calls.push(["currentFields", runId, idx]);
      return fields;
    },
    skipStages: async (runId, idxs) => {
      calls.push(["skipStages", runId, idxs]);
      return idxs.map((i) => `sr${i}`);
    },
    ifFacts: async () => ({ fieldsByIdx: {}, inputs: {} }),
    cancelTimers: async (runId, ids) => void calls.push(["cancelTimers", runId, ids]),
    // (tham số `now` bỏ qua — nhật ký chỉ ghi runId + ids)
    branchEvent: async (runId, e) => void calls.push(["branchEvent", runId, e]),
  };
  return { r: { steps, clock: { now: () => new Date(0) } }, calls };
}
const join = (
  step: number,
  steps: number[],
  st: StageRunStatus[],
  { kinds = [], branches = [] }: { kinds?: (string | undefined)[]; branches?: BranchRule[][] } = {},
): StepJoinLoad => ({
  step,
  steps,
  statuses: new Map(st.map((s, i) => [i, s] as const)),
  executorKinds: kinds,
  branches,
});
const RULE: BranchRule = { field: "tong_tien", op: "gt", value: 20_000_000, gotoStep: 3 };
/** Def 5 bước (0…4), s1 ở bước 1 rẽ nhánh `RULE`; bước 1 vừa xong. */
const BR = () =>
  join(1, [0, 1, 2, 3, 4], ["done", "done", "pending", "pending", "pending"], {
    branches: [[], [RULE]],
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
    const retry = fake(join(0, [0, 0], ["waiting_timer", "done"], { kinds: ["agent", "agent"] }));
    expect((await settleStep(retry.r, "r1"))?.status).toBe("running");
    expect(retry.calls).toEqual([["setStatus", "r1", "running", 0]]);
    const wait = fake(
      join(0, [0, 0], ["waiting_timer", "done"], { kinds: ["wait_until", "agent"] }),
    );
    expect(await settleStep(wait.r, "r1")).toEqual({
      kind: "wait",
      status: "waiting_timer",
      step: 0,
      stageIdx: 0,
    });
  });
});

describe("HUB-FR-147 · T19 · PD2-R13/R14 · rẽ nhánh trong join bước", () => {
  it("khớp ⇒ đọc fields, nhảy stage bước giữa, huỷ hẹn của chúng, sự kiện branch, xếp hàng bước đích", async () => {
    const f = fake(BR(), { tong_tien: 25_000_000 });
    expect(await settleStep(f.r, "r1")).toEqual({
      kind: "next_step",
      status: "running",
      step: 3,
      stageIdx: 3,
    });
    expect(f.calls).toEqual([
      ["currentFields", "r1", 1],
      ["skipStages", "r1", [2]],
      ["cancelTimers", "r1", ["sr2"]],
      ["branchEvent", "r1", { stageIdx: 1, fromStep: 1, toStep: 3, rule: 1 }],
      ["queueStep", "r1", { idxs: [3], step: 3, first: 3 }],
    ]);
  });
  it("không khớp / fields null ⇒ chỉ thêm đọc fields, đi bước kế", async () => {
    for (const fields of [{ tong_tien: 1000 }, null]) {
      const f = fake(BR(), fields);
      expect((await settleStep(f.r, "r1"))?.step).toBe(2);
      expect(f.calls).toEqual([
        ["currentFields", "r1", 1],
        ["queueStep", "r1", { idxs: [2], step: 2, first: 2 }],
      ]);
    }
  });
  it("bước không có luật ⇒ không đọc fields (số câu như trước T19)", async () => {
    const f = fake(join(1, [0, 1, 2], ["done", "done", "pending"]));
    await settleStep(f.r, "r1");
    expect(f.calls).toEqual([["queueStep", "r1", { idxs: [2], step: 2, first: 2 }]]);
  });
  it("đích không có thật (snapshot hỏng) ⇒ bỏ nhánh, đi bước kế", async () => {
    const f = fake(
      join(1, [0, 1, 2], ["done", "done", "pending"], {
        branches: [[], [{ ...RULE, gotoStep: 9 }]],
      }),
      { tong_tien: 25_000_000 },
    );
    expect((await settleStep(f.r, "r1"))?.step).toBe(2);
  });
});

// CR-122 · E2 · FLOW2-FR-12/15 · H2: `settleStep` qua `StepRepo` giả — node Nếu đọc `fact`, bước gộp `next_step`, node Kết thúc
// (`OutcomeHandler` cùng tx, bỏ qua nhánh còn lại), dữ kiện đổi sau khi rẽ ⇒ "Cần xử lý". Không DB.
import { describe, expect, it } from "bun:test";
import type { IfExec } from "../../domain/if/if.rules";
import type { StageRunStatus } from "../../domain/types";
import type { FlowFactsRead, StepJoinLoad, StepRepo } from "../ports";
import { settleStep } from "./settle-step.usecase";

const PACK = { pack: "contracts", recordId: "rec-1", event: "contract.submitted" };

function fake(
  load: StepJoinLoad,
  o: { facts?: FlowFactsRead | null; decisions?: { stageIdx: number; matched: boolean }[] } = {},
) {
  const calls: unknown[][] = [];
  const steps: StepRepo = {
    loadJoin: async () => load,
    queueStep: async (_r, q) => void calls.push(["queueStep", q]),
    finish: async (_r, first) => void calls.push(["finish", first]),
    setStatus: async (_r, status, first) => void calls.push(["setStatus", status, first]),
    currentFields: async () => null,
    skipStages: async (_r, idxs) => {
      calls.push(["skipStages", idxs]);
      return idxs.map((i) => `sr${i}`);
    },
    ifFacts: async () => ({ fieldsByIdx: {}, inputs: {} }),
    cancelTimers: async (_r, ids) => void calls.push(["cancelTimers", ids]),
    branchEvent: async (_r, e) => void calls.push(["branchEvent", e]),
    readFacts: async (_p, keys) => {
      calls.push(["readFacts", keys]);
      return o.facts ?? null;
    },
    ifDecisions: async () => o.decisions ?? [],
    applyOutcome: async (_r, p, outcome) => void calls.push(["applyOutcome", p.pack, outcome]),
    needsAction: async (_r, a) => void calls.push(["needsAction", a]),
  };
  return { r: { steps, clock: { now: () => new Date(0) } }, calls };
}

const IF_GT: IfExec = {
  when: { op: "and", conds: [{ from: { kind: "fact", key: "value" }, op: "gt", value: 100 }] },
  thenStep: 2,
  elseStep: 4,
};
/** 0 agent · 1 Nếu(giá trị > 100: Đúng→2, Sai→4) · 2 Duyệt A (next_step 5) · 3 Kết thúc Từ chối · 4 Duyệt B · 5 Kết thúc Đã duyệt. */
const flow = (
  step: number,
  st: StageRunStatus[],
  pack: typeof PACK | null = PACK,
): StepJoinLoad => ({
  step,
  steps: [0, 1, 2, 3, 4, 5],
  statuses: new Map(st.map((s, i) => [i, s] as const)),
  executorKinds: ["agent", "if", "agent", "set", "agent", "set"],
  branches: [],
  ifs: [null, IF_GT, null, null, null, null],
  stageKeys: ["a", "if1", "b", "end_r", "c", "end_ok"],
  nextSteps: [undefined, undefined, 5, undefined, undefined, undefined],
  outcomes: [undefined, undefined, undefined, "rejected", undefined, "approved"],
  pack,
});
const P = "pending" as const;
const D = "done" as const;
const S = "skipped" as const;

describe("CR-122 · E2 · node Nếu đọc dữ kiện (FactsReader)", () => {
  it("giá trị hiện tại > 100 ⇒ Đúng, ghi giá trị đã đọc", async () => {
    const f = fake(flow(1, [D, D, P, P, P, P]), { facts: { value: 150_000_000 } });
    expect((await settleStep(f.r, "r1"))?.step).toBe(2);
    expect(f.calls).toContainEqual(["readFacts", ["value"]]);
    expect(f.calls).toContainEqual([
      "branchEvent",
      {
        stageIdx: 1,
        fromStep: 1,
        toStep: 2,
        rule: 1,
        facts: { matched: true, reads: [{ key: "value", value: 150_000_000 }] },
      },
    ]);
  });
  it("trường trống ⇒ nhánh Sai, lịch sử ghi null (chưa có dữ liệu)", async () => {
    const f = fake(flow(1, [D, D, P, P, P, P]), { facts: { value: null } });
    expect((await settleStep(f.r, "r1"))?.step).toBe(4);
    expect(f.calls).toContainEqual(["skipStages", [2, 3]]);
    const ev = f.calls.find((c) => c[0] === "branchEvent")?.[1] as { facts: unknown };
    expect(ev.facts).toEqual({ matched: false, reads: [{ key: "value", value: null }] });
  });
  it("bản ghi không thấy (reader trả null) ⇒ Sai", async () => {
    const f = fake(flow(1, [D, D, P, P, P, P]), { facts: null });
    expect((await settleStep(f.r, "r1"))?.step).toBe(4);
  });
});

describe("CR-122 · E2 · bước gộp next_step", () => {
  it("cuối nhánh Đúng (next_step 5) ⇒ nhảy tới bước gộp, nhánh kia skipped + huỷ hẹn", async () => {
    const f = fake(flow(2, [D, D, D, P, S, P]));
    expect(await settleStep(f.r, "r1")).toEqual({
      kind: "next_step",
      status: "running",
      step: 5,
      stageIdx: 5,
    });
    expect(f.calls).toEqual([
      ["skipStages", [3, 4]],
      ["cancelTimers", ["sr3", "sr4"]],
      ["queueStep", { idxs: [5], step: 5, first: 5 }],
    ]);
  });
});

describe("CR-122 · E2 · node Kết thúc", () => {
  it("bước Kết thúc xong ⇒ OutcomeHandler cùng tx, bỏ qua nhánh sau, run done", async () => {
    const f = fake(flow(3, [D, D, S, D, P, P]));
    expect(await settleStep(f.r, "r1")).toEqual({
      kind: "finish",
      status: "done",
      step: 3,
      stageIdx: 3,
    });
    expect(f.calls).toEqual([
      ["applyOutcome", "contracts", "rejected"],
      ["skipStages", [4, 5]],
      ["cancelTimers", ["sr4", "sr5"]],
      ["finish", 3],
    ]);
  });
  it("Kết thúc cuối flow ⇒ không skip, gọi handler rồi finish", async () => {
    const f = fake(flow(5, [D, D, D, S, S, D]), {
      decisions: [{ stageIdx: 1, matched: true }],
      facts: { value: 150 },
    });
    expect((await settleStep(f.r, "r1"))?.kind).toBe("finish");
    expect(f.calls.map((c) => c[0])).toEqual(["readFacts", "applyOutcome", "finish"]);
  });
  it("lượt cũ không gắn gói ⇒ chỉ chốt lượt (không handler)", async () => {
    const f = fake(flow(5, [D, D, D, S, S, D], null));
    expect((await settleStep(f.r, "r1"))?.kind).toBe("finish");
    expect(f.calls).toEqual([["finish", 5]]);
  });
  it("H2 · giá trị đổi sau khi rẽ (Đúng lúc rẽ, nay 50) ⇒ Cần xử lý, KHÔNG gọi handler", async () => {
    const f = fake(flow(5, [D, D, D, S, S, D]), {
      decisions: [{ stageIdx: 1, matched: true }],
      facts: { value: 50 },
    });
    expect(await settleStep(f.r, "r1")).toEqual({
      kind: "wait",
      status: "needs_decision",
      step: 5,
      stageIdx: 5,
    });
    expect(f.calls).toContainEqual(["needsAction", { finishIdxs: [5], ifIdx: 1, first: 5 }]);
    expect(f.calls.some((c) => c[0] === "applyOutcome" || c[0] === "finish")).toBe(false);
  });
  it("bước Kết thúc chưa xong (stage còn chạy) ⇒ chỉ đặt trạng thái chờ", async () => {
    const f = fake(flow(5, [D, D, D, S, S, "running"]));
    expect((await settleStep(f.r, "r1"))?.kind).toBe("wait");
    expect(f.calls.some((c) => c[0] === "applyOutcome")).toBe(false);
  });
});

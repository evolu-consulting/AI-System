// contract-flow S3a · luật thuần duyệt trên engine: bước bắt buộc ⇒ finalize, tham số `from_step`, điều kiện mở run, ánh xạ stage.
import { describe, expect, it } from "bun:test";
import {
  engineStartable,
  factsOf,
  finalizeReady,
  finalizesOnApprove,
  passedUserSteps,
  posOfStage,
  routeFrom,
  userStepOfEngine,
} from "./approval-engine.rules";
import type { FlowStep } from "./approval-flow.rules";

const G = "00000000-0000-4000-8000-0000000000a1";
const review = (key: string, when: unknown = null): FlowStep =>
  ({
    kind: "review",
    key,
    name: key,
    department_group_id: G,
    head_only: false,
    due_h: 72,
    remind_every_h: null,
    escalate_group_id: null,
    exclude_starter: false,
    when,
  }) as FlowStep;
const BIG = { op: "and", conds: [{ field: "total_value", op: "ge", value: 1000 }] };
const TWO = [review("l1"), review("l2", BIG)];
const DIFY: FlowStep = { kind: "dify", key: "d", name: "d", workflow_key: "wf-x", after: "auto" };

describe("finalizeReady", () => {
  it("dưới ngưỡng: chỉ cần s0; trên ngưỡng / trống: cần s0 + s1", () => {
    expect(finalizeReady(TWO, factsOf("buy", 10), ["s0"])).toBe(true);
    expect(finalizeReady(TWO, factsOf("buy", 5000), ["s0"])).toBe(false);
    expect(finalizeReady(TWO, factsOf("buy", null), ["s0"])).toBe(false);
    expect(finalizeReady(TWO, factsOf("buy", 5000), ["s0", "route", "s1"])).toBe(true);
  });
  it("chưa Đạt s0 ⇒ false; stage lạ bỏ qua; mẫu rỗng ⇒ false; bước Dify không đòi Đạt", () => {
    expect(finalizeReady(TWO, factsOf("sell", 10), ["route", "finalize", "s9"])).toBe(false);
    expect(finalizeReady([], factsOf("sell", 10), ["s0"])).toBe(false);
    expect(finalizeReady([review("a"), DIFY, review("b")], factsOf(null, 1), ["s0", "s2"])).toBe(
      true,
    );
  });
});

describe("routeFrom / engineStartable / factsOf", () => {
  it("from_step: số nguyên 0..n-1 (chuỗi số nhận), còn lại null", () => {
    expect([0, 1, "1", 2, -1, 1.5, "x", null].map((v) => routeFrom(v, 2))).toEqual([
      0,
      1,
      1,
      null,
      null,
      null,
      null,
      null,
    ]);
  });
  it("chỉ lượt level1 chế độ máy chưa có run", () => {
    const ok = { approvalStatus: "level1", mode: "machine", engineRunId: null };
    expect(engineStartable(ok)).toBe(true);
    expect(engineStartable({ ...ok, mode: "engine" })).toBe(false);
    expect(engineStartable({ ...ok, engineRunId: G })).toBe(false);
    expect(engineStartable({ ...ok, approvalStatus: "extracting" })).toBe(false);
  });
  it("loại HĐ lạ ⇒ null", () => {
    expect(factsOf("lease", 1)).toEqual({ deal: null, total_value: 1 });
    expect(factsOf("buy", 1)).toEqual({ deal: "buy", total_value: 1 });
  });
});

describe("ánh xạ stage ↔ bước", () => {
  it("userStepOfEngine / posOfStage / passedUserSteps", () => {
    expect([0, 1, 2, 3, 4].map((e) => userStepOfEngine(e, 2))).toEqual([
      { kind: "user", step: 0 },
      { kind: "route" },
      { kind: "user", step: 1 },
      { kind: "finalize" },
      { kind: "unknown" },
    ]);
    expect(posOfStage("s1", 2)).toEqual({ kind: "user", step: 1 });
    expect(posOfStage("s2", 2)).toEqual({ kind: "unknown" });
    expect(passedUserSteps(["s1", "s0", "s1", "route"], 2)).toEqual([0, 1]);
  });
  it("finalizesOnApprove: bước review áp dụng cuối", () => {
    expect(finalizesOnApprove(TWO, factsOf("buy", 10), 0)).toBe(true);
    expect(finalizesOnApprove(TWO, factsOf("buy", 5000), 0)).toBe(false);
    expect(finalizesOnApprove(TWO, factsOf("buy", 5000), 1)).toBe(true);
  });
});

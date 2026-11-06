// CR-122 · E2b · luật thuần: node Duyệt (quyết định ⇒ kết quả cổng), luật lưu APPROVE_INVALID, "Chạy lại từ Nếu" (CAS theo
// trạng thái + lý do), vế `fact` của Nếu kiểm theo `AppEventDecl.facts` khi lưu FlowDef.
import { describe, expect, it } from "bun:test";
import { approveStageIssues, flowDefIssues } from "@ai/contracts/hub-admin";
import { rerunIfTarget } from "../domain/runs/run-control.rules";
import { approveOutcomeOf } from "./approve-out";

const ap = (reject_step: number | null, return_step: number | null) => ({
  executor: { kind: "approve", reject_step, return_step },
});

describe("approveOutcomeOf", () => {
  it("Duyệt ⇒ approved/pass; có đích ⇒ Từ chối/Trả lại chạy như Đạt", () => {
    expect(approveOutcomeOf(ap(3, 4), "pass")).toEqual({ decision: "approved", gate: "pass" });
    expect(approveOutcomeOf(ap(3, 4), "reject")).toEqual({ decision: "rejected", gate: "pass" });
    expect(approveOutcomeOf(ap(3, 4), "fail")).toEqual({ decision: "returned", gate: "pass" });
  });
  it("không đích ⇒ giữ hành vi cổng cũ, stage khác ⇒ null", () => {
    expect(approveOutcomeOf(ap(null, null), "reject")?.gate).toBe("reject");
    expect(approveOutcomeOf(ap(null, null), "fail")?.gate).toBe("fail");
    expect(approveOutcomeOf({ executor: { kind: "agent" } }, "reject")).toBeNull();
  });
});

describe("approveStageIssues", () => {
  const st = (after: string, ex: object, real = false) => ({
    real_action: real,
    after: { kind: after },
    executor: { kind: "approve", ...ex },
  });
  it("hợp lệ: review, một mình, đích sau", () => {
    const stages = [
      { real_action: false, after: { kind: "auto" }, executor: { kind: "agent" } },
      st("review", { reject_step: 2, return_step: null }),
      { real_action: false, after: { kind: "auto" }, executor: { kind: "set" } },
    ];
    expect(approveStageIssues(stages, [0, 1, 2])).toEqual([]);
  });
  it("auto / đích lùi / đích ngoài ⇒ APPROVE_INVALID", () => {
    const stages = [st("auto", { reject_step: 0, return_step: 9 })];
    expect(approveStageIssues(stages, [0]).map((x) => x.path)).toEqual([
      "stages.0",
      "stages.0.executor.reject_step",
      "stages.0.executor.return_step",
    ]);
  });
});

describe("rerunIfTarget", () => {
  const kinds = ["agent", "if", "set"];
  it("needs_decision + facts_changed + stage Nếu ⇒ idx", () => {
    expect(rerunIfTarget("needs_decision", { reason: "facts_changed", stage_idx: 1 }, kinds)).toBe(
      1,
    );
  });
  it("bấm lần 2 (đã running, decision null) / lý do khác / không phải Nếu ⇒ null", () => {
    expect(rerunIfTarget("running", null, kinds)).toBeNull();
    expect(
      rerunIfTarget("needs_decision", { reason: "redo_limit", stage_idx: 1 }, kinds),
    ).toBeNull();
    expect(
      rerunIfTarget("needs_decision", { reason: "facts_changed", stage_idx: 2 }, kinds),
    ).toBeNull();
  });
});

describe("flowDefIssues · vế fact của Nếu", () => {
  const ev = {
    key: "c.submitted",
    label: "x",
    facts: [
      { key: "value", label: "Giá trị", type: "number" },
      { key: "kind", label: "Loại", type: "enum" },
    ],
    outcomes: [{ key: "approved", label: "Đã duyệt", effect: "x" }],
  };
  const def = (conds: object[]) => ({
    owner: "library" as const,
    trigger: { event: "c.submitted" },
    stages: [
      { step: 0, executor: { kind: "if", when: { conds } } },
      { step: 1, outcome: "approved" },
    ],
  });
  it("khoá có + đúng kiểu ⇒ hợp lệ", () => {
    const d = def([{ from: { kind: "fact", key: "value" }, op: "gt", value: 100 }]);
    expect(flowDefIssues(d as never, [ev] as never)).toEqual([]);
  });
  it("khoá lạ / sai kiểu ⇒ FLOW_WHEN_INVALID đúng đường dẫn", () => {
    const d = def([
      { from: { kind: "fact", key: "khong_co" }, op: "eq", value: "x" },
      { from: { kind: "fact", key: "value" }, op: "gt", value: "abc" },
      { from: { kind: "input", key: "x" }, op: "eq", value: "y" },
    ]);
    expect(flowDefIssues(d as never, [ev] as never)).toEqual([
      { path: "stages.0.executor.when.conds.0", rule: "FLOW_WHEN_INVALID" },
      { path: "stages.0.executor.when.conds.1", rule: "FLOW_WHEN_INVALID" },
    ]);
  });
});

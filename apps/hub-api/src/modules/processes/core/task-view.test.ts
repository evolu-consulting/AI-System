// HUB-FR-128 · P-c1 · PC-R10 · `toTaskDetail.options`: autofix_* ⇒ [add_attempt, cancel] kể cả có output.
import { describe, expect, it } from "bun:test";
import { DECISION_OPTIONS, type DecisionReason } from "@ai/contracts/chat";
import { type TaskRow, toTaskDetail } from "./task-view";

const row = (reason: DecisionReason): TaskRow => ({
  id: "00000000-0000-0000-0000-000000000001",
  kind: "decision",
  status: "open",
  stageIdx: 0,
  question: null,
  choices: null,
  excerpt: null,
  reason,
  result: null,
  createdAt: new Date("2026-10-14T00:00:00Z"),
});
const opts = (reason: DecisionReason, hasOutput: boolean) =>
  toTaskDetail(row(reason), {
    forwards: [],
    users: new Map(),
    output: null,
    hasOutput,
    stageName: "S1",
    canAct: true,
  }).options;

describe("toTaskDetail options [HUB-FR-128]", () => {
  it("autofix_check_failed / sandbox_unavailable có output ⇒ [add_attempt, cancel]", () => {
    expect(opts("autofix_check_failed", true)).toEqual(["add_attempt", "cancel"]);
    expect(opts("sandbox_unavailable", true)).toEqual(["add_attempt", "cancel"]);
  });
  it("autofix_* không output ⇒ [add_attempt, cancel]", () => {
    expect(opts("autofix_check_failed", false)).toEqual(["add_attempt", "cancel"]);
  });
  it("lý do thường giữ như cũ: có output đủ, không output bỏ use_current", () => {
    expect(opts("interrupted", true)).toEqual([...DECISION_OPTIONS]);
    expect(opts("interrupted", false)).toEqual(DECISION_OPTIONS.filter((o) => o !== "use_current"));
  });
  it("team_* / permission_lost không output: hành vi cũ (bỏ use_current, nợ TD-168)", () => {
    expect(opts("team_calls", false)).not.toContain("use_current");
    expect(opts("permission_lost", false)).not.toContain("use_current");
  });
});

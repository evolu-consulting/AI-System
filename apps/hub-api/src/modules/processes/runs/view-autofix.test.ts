// HUB-FR-128 · PC-R14 · view task gắn `autofix` chỉ cho stage có task duyệt của người xem; schema task view chấp nhận.
import { describe, expect, it } from "bun:test";
import { type AutofixStageView, ProcessRunTaskViewSchema } from "@ai/contracts/chat";
import { onlyMyReviewStages, withAutofix } from "./view-autofix";

const U = "00000000-0000-4000-8000-000000000001";
const af = {
  source_key: "app",
  pin_sha: null,
  branch: "ai/x/fix",
  round: 1,
  status: "ok",
  diff_stats: null,
  diff_file: null,
  test_log_file: null,
  test: null,
  failures: [],
  created_at: "2026-10-14T00:00:00.000000Z",
} as AutofixStageView;

describe("HUB-FR-128 · PC-R14 · task view autofix", () => {
  const all = new Map([
    [0, af],
    [1, af],
  ]);
  it("chỉ stage có task review của người xem", () => {
    const m = onlyMyReviewStages(all, [
      { kind: "review", stage_idx: 1 },
      { kind: "ask", stage_idx: 0 },
    ]);
    expect([...m.keys()]).toEqual([1]);
    expect(onlyMyReviewStages(all, []).size).toBe(0);
  });

  it("ProcessRunTaskViewSchema nhận stages[].autofix (tùy chọn)", () => {
    const st = (idx: number) => ({ idx, name: "S", status: "waiting_review", step: idx, round: 1 });
    const stages = withAutofix([st(0), st(1)], new Map([[1, af]]));
    const view = {
      access: "task",
      id: U,
      process: { key: "kk", name: "K" },
      status: "running",
      stages,
      my_tasks: [],
    };
    const r = ProcessRunTaskViewSchema.safeParse(view);
    expect(r.success ? "" : JSON.stringify(r.error.issues)).toBe("");
    expect(stages[0]).not.toHaveProperty("autofix");
    expect(stages[1]?.autofix?.source_key).toBe("app");
  });
});

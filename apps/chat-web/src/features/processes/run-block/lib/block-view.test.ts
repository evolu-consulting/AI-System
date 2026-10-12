// CHAT-AC-52/53 · luật thuần của khối quy trình (myActions, stageItems, currentStage).
import { describe, expect, test } from "bun:test";
import type { ProcessRunFullView, TaskDetail } from "@ai/contracts/chat";
import { backTrail, currentStage, myActions, stageItems } from "./block-view";

const task = (
  id: string,
  kind: TaskDetail["kind"],
  status: TaskDetail["status"] = "open",
): TaskDetail => ({
  id,
  kind,
  status,
  stage_idx: 0,
  stage_name: "S",
  forwards: [],
  can_act: true,
  created_at: "2026-10-10T00:00:00.000Z",
});

const view = (p: { mine?: TaskDetail[]; canDecide?: boolean; cur?: number }): ProcessRunFullView =>
  ({
    access: "full",
    current_stage_idx: p.cur ?? 0,
    my_tasks: p.mine ?? [],
    open_tasks: [],
    stages: [
      { idx: 0, name: "Soạn", status: "done" },
      { idx: 1, name: "Kiểm", status: "running" },
    ],
    decision: p.canDecide
      ? { reason: "redo_limit", stage_idx: 1, options: ["cancel"], can_decide: true }
      : null,
  }) as unknown as ProcessRunFullView;

describe("myActions", () => {
  test("mỗi loại việc mở ⇒ một nút, theo thứ tự review/answer/decide", () => {
    expect(myActions(view({ mine: [task("a", "ask"), task("b", "review")] }))).toEqual([
      "review",
      "answer",
    ]);
  });
  test("việc đã đóng không tạo nút", () => {
    expect(myActions(view({ mine: [task("a", "review", "closed")] }))).toEqual([]);
  });
  test("can_decide ⇒ nút Quyết định dù không là assignee", () => {
    expect(myActions(view({ canDecide: true }))).toEqual(["decide"]);
  });
});

describe("stageItems / currentStage", () => {
  test("map tên + trạng thái", () => {
    expect(stageItems(view({}))).toEqual([
      { idx: 0, name: "Soạn", status: "done" },
      { idx: 1, name: "Kiểm", status: "running" },
    ]);
  });
  test("currentStage theo current_stage_idx", () => {
    expect(currentStage(view({ cur: 1 }))?.name).toBe("Kiểm");
  });
});

describe("stageItems / backTrail (P-b2)", () => {
  const v = (extra: Record<string, unknown>) =>
    ({ ...view({}), ...extra }) as unknown as ProcessRunFullView;
  test("stageItems mang step/round", () => {
    const x = v({
      stages: [
        { idx: 0, name: "A", status: "done", step: 0, round: 1 },
        { idx: 1, name: "B", status: "running", step: 1, round: 2 },
      ],
    });
    expect(stageItems(x).map((s) => [s.step, s.round])).toEqual([
      [0, 1],
      [1, 2],
    ]);
  });
  test("không sự kiện, chưa hết lượt ⇒ undefined", () => {
    expect(backTrail(v({ back_events: [], back_rounds: 0, back_limit: 3 }))).toBeUndefined();
    expect(backTrail(view({}))).toBeUndefined();
  });
  test("có sự kiện ⇒ bước đích UI = to_step+1, n = số sự kiện", () => {
    const ev = (to: number) => ({ to_step: to });
    expect(backTrail(v({ back_events: [ev(1), ev(0)], back_rounds: 2, back_limit: 3 }))).toEqual({
      step: 1,
      count: 2,
      max: undefined,
    });
  });
  test("back_rounds ≥ back_limit ⇒ max (kể cả khi không có sự kiện)", () => {
    expect(backTrail(v({ back_events: [], back_rounds: 3, back_limit: 3 }))).toEqual({
      step: undefined,
      count: 0,
      max: 3,
    });
  });
});

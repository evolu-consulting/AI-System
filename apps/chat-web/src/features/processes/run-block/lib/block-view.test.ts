// CHAT-AC-52/53 · luật thuần của khối quy trình (myActions, stageItems, currentStage).
import { describe, expect, test } from "bun:test";
import type { ProcessRunFullView, TaskDetail } from "@ai/contracts/chat";
import { currentStage, myActions, stageItems } from "./block-view";

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

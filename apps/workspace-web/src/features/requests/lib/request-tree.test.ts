// CR-125 · cr125-request-steps · cây lượt của trang yêu cầu: thứ tự cha → con, lượt đầu có việc, chuyển sang lượt gốc.
import { describe, expect, test } from "bun:test";
import type { FlowView } from "@ai/contracts/flow";
import type { RequestStepNode } from "@ai/contracts/hub-admin";
import { firstActionable, flattenSteps, redirectToRoot } from "./request-tree";

const flow = (tasks: FlowView["tasks"] = []): FlowView => ({
  slot: "processes.request",
  ref: "r",
  run: null,
  state: "running",
  phase: null,
  note: null,
  attention: null,
  block_reason: null,
  steps: [],
  tasks,
});
const node = (id: string, children: RequestStepNode[] = [], mine = false): RequestStepNode => ({
  run_id: id,
  name: id,
  status: "running",
  parent_stage_idx: null,
  back_to_step: null,
  flow: flow(
    mine
      ? [
          {
            task_id: "00000000-0000-4000-8000-000000000001",
            step_key: "k",
            kind: "review",
            actions: [],
          },
        ]
      : [],
  ),
  children,
});

describe("request-tree", () => {
  const tree = node("root", [node("p1", [node("p1a", [], true)]), node("p2", [], true)]);
  test("flattenSteps: cha trước, con theo thứ tự", () => {
    expect(flattenSteps(tree).map((n) => n.run_id)).toEqual(["root", "p1", "p1a", "p2"]);
  });
  test("firstActionable: lượt đầu tiên người xem có task; không có ⇒ null", () => {
    expect(firstActionable(tree)?.run_id).toBe("p1a");
    expect(firstActionable(node("x", [node("y")]))).toBeNull();
  });
  test("redirectToRoot: chỉ khi biết lượt gốc khác lượt đang mở", () => {
    expect(redirectToRoot("c", "r")).toEqual({ runId: "r", focus: "c" });
    expect(redirectToRoot("r", "r")).toBeNull();
    expect(redirectToRoot("c", null)).toBeNull();
  });
});

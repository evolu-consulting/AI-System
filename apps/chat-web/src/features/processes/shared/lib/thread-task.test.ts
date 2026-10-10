// CR-056 · P-a Bước 0: luật thuần của việc trong thread (taskSlot, waitNames, stepsSummary, threadTitle).
import { describe, expect, test } from "bun:test";
import type { OpenTask, ProcessRunView, TaskDetail } from "@ai/contracts/chat";
import { stepsSummary, taskSlot, threadTitle, waitNames } from "./thread-task";

const U = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
const task = (id: string, kind: TaskDetail["kind"] = "review"): TaskDetail => ({
  id,
  kind,
  status: "open",
  stage_idx: 0,
  stage_name: "S",
  forwards: [],
  can_act: true,
  created_at: "2026-10-10T00:00:00.000Z",
});
const open = (
  id: string,
  kind: OpenTask["kind"],
  names: string[] = [],
  group?: string,
): OpenTask => ({
  id,
  kind,
  stage_idx: 0,
  assignees: names.map((display_name, i) => ({ id: U(i + 1), display_name })),
  group: group ? { id: U(9), name: group } : null,
});
const view = (p: {
  mine?: TaskDetail[];
  opens?: OpenTask[];
  canDecide?: boolean;
}): ProcessRunView =>
  ({
    access: "full",
    process: { key: "k", name: "N", version: 1 },
    my_tasks: p.mine ?? [],
    open_tasks: p.opens ?? [],
    stages: [{ name: "Giai đoạn 1" }],
    updated_at: "2026-10-10T00:00:00.000Z",
    decision: p.canDecide
      ? { reason: "redo_limit", stage_idx: 0, options: ["cancel"], can_decide: true }
      : null,
  }) as unknown as ProcessRunView;

describe("taskSlot", () => {
  test("có trong my_tasks ⇒ mine", () => {
    expect(taskSlot(view({ mine: [task("a")] }), "a").state).toBe("mine");
  });
  test("chỉ có trong open_tasks ⇒ waiting", () => {
    expect(taskSlot(view({ opens: [open("a", "review", ["Hoa"])] }), "a").state).toBe("waiting");
  });
  test("decision + can_decide (admin) ⇒ mine dù không là assignee", () => {
    const s = taskSlot(view({ opens: [open("d", "decision")], canDecide: true }), "d");
    expect(s.state).toBe("mine");
  });
  test("việc đã đóng / view chưa tải ⇒ none", () => {
    expect(taskSlot(view({}), "zz").state).toBe("none");
    expect(taskSlot(undefined, "a").state).toBe("none");
  });
});

describe("waitNames", () => {
  test("≤ 3 tên + phần còn lại", () => {
    expect(waitNames(open("a", "ask", ["A", "B", "C", "D", "E"]))).toEqual({
      kind: "people",
      names: ["A", "B", "C"],
      more: 2,
    });
  });
  test("nhóm không có người cụ thể ⇒ group", () => {
    expect(waitNames(open("a", "review", [], "Kế toán"))).toEqual({
      kind: "group",
      group: "Kế toán",
    });
  });
  test("không ai ⇒ none", () => {
    expect(waitNames(open("a", "review"))).toEqual({ kind: "none" });
  });
});

describe("stepsSummary", () => {
  test("cộng ms (bỏ null) và token", () => {
    const step = (ms: number | null, tokens: number) => ({
      role: "agent" as const,
      member_key: null,
      agent: { key: "a", name: "A" },
      model: null,
      ms,
      tokens,
    });
    expect(stepsSummary([step(1000, 5), step(null, 7), step(500, 1)])).toEqual({
      count: 3,
      ms: 1500,
      tokens: 13,
    });
    expect(stepsSummary([step(null, 2)]).ms).toBeNull();
  });
});

describe("threadTitle", () => {
  test("khối gốc ⇒ tên · !key; hỏng ⇒ content", () => {
    expect(
      threadTitle({
        content: "x",
        process: {
          kind: "block",
          process_run_id: U(1),
          process: { key: "hoa-don", name: "Hoá đơn" },
          stage_count: 2,
        },
      }),
    ).toBe("Hoá đơn · !hoa-don");
    expect(threadTitle({ content: "tóm tắt" })).toBe("tóm tắt");
  });
});

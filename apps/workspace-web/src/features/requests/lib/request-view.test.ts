// CR-126 · cr126-request-page · dòng chờ, tóm tắt người duyệt, «Duyệt bởi».
import { describe, expect, test } from "bun:test";
import type { FlowStepView } from "@ai/contracts/flow";
import type { RequestStepNode } from "@ai/contracts/hub-admin";
import {
  approvedBy,
  currentNode,
  summaryOf,
  summaryText,
  waitingOf,
  waitingText,
} from "./request-view";

const step = (o: Record<string, unknown>): FlowStepView =>
  ({
    key: "k",
    name: "Duyệt",
    kind: "review",
    status: "pending",
    assignee: null,
    decided_by: null,
    decided_at: null,
    ...o,
  }) as unknown as FlowStepView;
const node = (
  id: string,
  steps: FlowStepView[],
  children: RequestStepNode[] = [],
  status = "running",
) =>
  ({
    run_id: id,
    name: id,
    status,
    parent_stage_idx: null,
    back_to_step: null,
    flow: { tasks: [], steps },
    children,
  }) as unknown as RequestStepNode;

describe("waitingOf", () => {
  test("done", () => expect(waitingOf(node("a", []), "done")).toEqual({ kind: "done" }));
  test("mở ở Phần 2 kèm tên nhóm", () => {
    const root = node(
      "a",
      [step({ status: "passed" })],
      [
        node("b", [
          step({
            status: "open",
            name: "Pháp chế duyệt",
            assignee: { kind: "group", id: null, label: "Pháp chế", head_only: false },
          }),
        ]),
      ],
    );
    const w = waitingOf(root, "waiting_review");
    expect(w.kind === "waiting" && waitingText(w.items, "Phần")).toBe(
      "Pháp chế · Phần 2 – Pháp chế duyệt",
    );
  });
  test("một lượt: không có «Phần»", () => {
    const w = waitingOf(node("a", [step({ status: "needs_decision" })]), "needs_decision");
    expect(w.kind === "waiting" && waitingText(w.items, "Phần")).toBe("Duyệt");
  });
  test("không bước mở ⇒ none", () =>
    expect(waitingOf(node("a", [step({})]), "running")).toEqual({ kind: "none" }));
});

describe("summaryOf", () => {
  const f = (key: string, label: string, type: string, value: string) => ({
    key,
    label,
    type,
    value,
  });
  test("đủ ba phần", () => {
    const s = summaryOf(
      [f("ncc", "Nhà cung cấp", "text", "ABC"), f("tong_tien", "Tổng tiền", "money", "1500000")],
      "Lan",
    );
    expect(summaryText(s, "Người đề xuất")).toBe("ABC · 1.500.000 đ · Người đề xuất Lan");
  });
  test("thiếu thì bỏ", () => expect(summaryText(summaryOf([], undefined), "x")).toBe(""));
});

test("approvedBy", () => {
  const s = step({
    status: "passed",
    decided_by: { id: "u", name: "Hà" },
    decided_at: "2026-11-09T05:00:00Z",
  });
  expect(approvedBy(s)?.name).toBe("Hà");
  expect(approvedBy(s)?.date).toMatch(/^\d\d\/11$/);
  expect(approvedBy(step({ status: "open" }))).toBeNull();
});

test("currentNode: bước mở > gốc", () => {
  const b = node("b", [step({ status: "open" })]);
  expect(currentNode(node("a", [step({ status: "passed" })], [b])).run_id).toBe("b");
});

// CR-125 · cr125-request-steps · lượt KHÔNG gắn HĐ (phiếu «Tạo yêu cầu», Quy trình con) chiếu sang FlowView bằng CÙNG phép chiếu thẻ HĐ:
// bước form ⇒ `kind: form` + task «Gửi»; bước duyệt ⇒ Duyệt / Trả lại / Từ chối (không «Đọc lại»); không quyết được ⇒ không có task.
import { describe, expect, test } from "bun:test";
import { FlowViewSchema } from "@ai/contracts/flow";
import type { EngineStageView, EngineStepsView } from "./approval-engine-card.rules";
import { backTargetOfRun, flowViewOfRun } from "./approval-flow-view.rules";

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const FIELDS = [
  { key: "nha_cung_cap", type: "text", label: "Nhà cung cấp", max_len: 200, required: true },
  { key: "gia_bao", type: "money", label: "Giá báo", min: 0, required: false },
];
const stage = (idx: number, o: Partial<EngineStageView> = {}): EngineStageView => ({
  key: `b${idx}`,
  idx,
  name: `Bước ${idx}`,
  group_id: U(100 + idx),
  status: "pending",
  escalated_group_id: null,
  due_at: null,
  escalated: false,
  decided_by: null,
  decided_at: null,
  feedback: null,
  task: null,
  ...o,
});
const run = (steps: EngineStageView[], status = "waiting_review"): EngineStepsView => ({
  status,
  started_by: U(9),
  steps,
});

describe("flowViewOfRun", () => {
  test("bước form mở + người xem làm được ⇒ step form có trường, task form với MỘT hành động «Gửi»", () => {
    const sv = run([
      stage(0, {
        status: "open",
        task: { id: U(500), can_act: true },
        form: { fields: FIELDS, values: null },
      }),
      stage(1),
    ]);
    const v = FlowViewSchema.parse(flowViewOfRun(sv, U(1)));
    expect(v.state).toBe("running");
    expect(v.steps.map((s) => [s.key, s.kind, s.status])).toEqual([["b0", "form", "open"]]);
    expect(v.tasks).toHaveLength(1);
    expect(v.tasks[0]).toMatchObject({ task_id: U(500), step_key: "b0", kind: "form" });
    expect(v.tasks[0]?.actions.map((a) => a.key)).toEqual(["submit"]);
  });

  test("bước duyệt (idx > 0) ⇒ Duyệt / Trả lại / Từ chối, không «Đọc lại»; bước form đã gửi giữ giá trị chỉ đọc", () => {
    const sv = run([
      stage(0, {
        status: "passed",
        task_ref: U(499),
        form: { fields: FIELDS, values: { nha_cung_cap: "ABC", gia_bao: 5 } },
      }),
      stage(1, { status: "open", task: { id: U(501), can_act: true } }),
    ]);
    const v = FlowViewSchema.parse(flowViewOfRun(sv, U(1)));
    expect(v.steps).toHaveLength(2);
    const first = v.steps[0];
    expect(first?.kind === "form" && first.values).toEqual({ nha_cung_cap: "ABC", gia_bao: 5 });
    expect(v.tasks[0]).toMatchObject({ task_id: U(501), kind: "review" });
    expect(v.tasks[0]?.actions.map((a) => a.key)).toEqual(["approve", "return", "reject"]);
  });
});

describe("flowViewOfRun · quyền xem, đích trả lại", () => {
  test("người xem không quyết được hoặc lượt đã xong ⇒ không có task", () => {
    const open = run([stage(0, { status: "open", task: { id: U(502), can_act: false } })]);
    expect(flowViewOfRun(open, U(1)).tasks).toEqual([]);
    const done = run([stage(0, { status: "passed", task_ref: U(503) })], "done");
    const v = flowViewOfRun(done, U(1));
    expect(v.state).toBe("done");
    expect(v.tasks).toEqual([]);
  });

  test("đích «Trả lại» = back_to_steps[0] của bước mở; không có ⇒ null", () => {
    const base = [stage(0, { status: "passed", task_ref: U(1) })];
    const withBack = run([
      ...base,
      stage(1, { status: "open", task: { id: U(504), can_act: true }, back_to_steps: [0] }),
    ]);
    expect(backTargetOfRun(withBack)).toBe(0);
    const none = run([...base, stage(1, { status: "open", task: { id: U(505), can_act: true } })]);
    expect(backTargetOfRun(none)).toBeNull();
  });
});

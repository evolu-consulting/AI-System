import { describe, expect, it } from "bun:test";
import { type SlotFlowBody, withConfirmStep } from "./approval-slot.rules";

const rv = (key: string, dept: string) =>
  ({ kind: "review", key, name: key, department_group_key: dept }) as SlotFlowBody["steps"][number];

describe("withConfirmStep", () => {
  it("quy trình chỉ có bước duyệt ⇒ thêm bước xác nhận (nhóm sửa) ở đầu", () => {
    const out = withConfirmStep(
      { steps: [rv("kt", "pb-ke-toan"), rv("gd", "pb-giam-doc")] },
      "contracts-editor",
    );
    expect(out.steps.map((s) => s.key)).toEqual(["confirm", "kt", "gd"]);
    expect(out.steps[0]).toMatchObject({
      department_group_key: "contracts-editor",
      head_only: false,
      exclude_starter: false,
      when: null,
    });
  });
  it("bước đầu đã là nhóm sửa (mặc định / bản nhân bản) ⇒ giữ nguyên, không hai bước xác nhận", () => {
    const body = { steps: [rv("level1", "contracts-editor"), rv("level2", "contracts-owner")] };
    expect(withConfirmStep(body, "contracts-editor")).toBe(body);
  });
  it("đã có khoá confirm ⇒ không thêm lần nữa", () => {
    const body = { steps: [rv("confirm", "pb-x"), rv("kt", "pb-ke-toan")] };
    expect(withConfirmStep(body, "contracts-editor")).toBe(body);
  });
});

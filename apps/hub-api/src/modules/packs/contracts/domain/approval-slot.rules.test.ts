// CR-105 · L1 · luật thuần khe `contracts.approval`: mã ⇒ id theo tenant (thiếu ⇒ null), validate cấm id Group trong body thư viện,
// compile ra stages trỏ Group bằng `*_key`.
import { describe, expect, it } from "bun:test";
import {
  compileSlotStages,
  resolveSlotSteps,
  type SlotFlowBody,
  slotGroupKeys,
  validateSlotBody,
} from "./approval-slot.rules";

const review = (key: string, dept: string, extra: Record<string, unknown> = {}) => ({
  kind: "review" as const,
  key,
  name: key,
  department_group_id: null,
  department_group_key: dept,
  head_only: false,
  due_h: 72,
  remind_every_h: null,
  escalate_group_id: null,
  exclude_starter: false,
  when: null,
  ...extra,
});
const body = {
  steps: [review("kt", "ke-toan"), review("gd", "giam-doc", { escalate_group_key: "tgd" })],
} as SlotFlowBody;

describe("CR-105 · khe contracts.approval", () => {
  it("mã ⇒ id theo tenant; thiếu một mã ⇒ null (máy cũ)", () => {
    expect(slotGroupKeys(body)).toEqual(["ke-toan", "tgd", "giam-doc"]);
    const ids = new Map([
      ["ke-toan", "id-kt"],
      ["giam-doc", "id-gd"],
      ["tgd", "id-tgd"],
    ]);
    const steps = resolveSlotSteps(body, ids);
    expect(
      steps?.map((s) =>
        s.kind === "review" ? [s.department_group_id, s.escalate_group_id] : null,
      ),
    ).toEqual([
      ["id-kt", null],
      ["id-gd", "id-tgd"],
    ]);
    expect(JSON.stringify(steps)).not.toContain("_group_key");
    ids.delete("tgd");
    expect(resolveSlotSteps(body, ids)).toBeNull();
  });

  it("validate: body hợp lệ ⇒ rỗng; id Group trong body thư viện ⇒ GROUP_ID_IN_LIBRARY; sai hình ⇒ SLOT_SHAPE", () => {
    expect(validateSlotBody(body)).toEqual([]);
    const leak = { steps: [review("kt", "ke-toan", { department_group_id: "x" })] };
    expect(validateSlotBody(leak)).toEqual([
      { path: "steps.0.department_group_id", rule: "GROUP_ID_IN_LIBRARY" },
    ]);
    expect(validateSlotBody({ steps: "x" })).toEqual([{ path: "steps", rule: "SLOT_SHAPE" }]);
    expect(validateSlotBody({ steps: [review("kt", "")] })).toEqual([
      { path: "steps.0.department_group_id", rule: "GROUP_REQUIRED" },
    ]);
  });

  it("compile: stages trỏ Group bằng *_key, không còn id", () => {
    const stages = compileSlotStages(body) as { after: Record<string, unknown> }[];
    const reviews = stages.filter((s) => s.after.kind === "review").map((s) => s.after);
    expect(reviews.map((a) => [a.group_id, a.group_key, a.escalate])).toEqual([
      [null, "ke-toan", null],
      [null, "giam-doc", { after_h: 72, group_key: "tgd" }],
    ]);
  });
});

import { describe, expect, test } from "bun:test";
import type { StageDraft } from "./draft-types";
import { defaultReviewSlot, engineStepOf, normalizeSlotStages } from "./slot-canvas";
import { emptyStage } from "./stage-convert";

const tool = (key: string, step: number, p: Partial<StageDraft> = {}): StageDraft => ({
  ...emptyStage(step),
  name: key,
  executor: "tool",
  tool: { key: "contracts-route", args: {} },
  ...p,
  key: p.key ?? key,
  step,
});
const review = (i: number, name: string, slot: Record<string, unknown> = {}): StageDraft =>
  tool(`s${i}`, engineStepOf(i), {
    name,
    after: "review",
    slotRaw: { ...defaultReviewSlot(name), key: `lv${i}`, ...slot },
  });

describe("repairSlot", () => {
  test("mã nằm ở *_group_id (seed 0069) ⇒ chuyển sang *_group_key; uuid ⇒ bỏ", async () => {
    const { repairSlot } = await import("./slot-canvas");
    expect(
      repairSlot({
        department_group_id: "contracts-editor",
        escalate_group_id: "9d1c2c9e-8f0a-4e3b-9c1d-2f7d7a1b2c3d",
        due_h: 72,
      }),
    ).toMatchObject({
      department_group_key: "contracts-editor",
      department_group_id: null,
      escalate_group_id: null,
      due_h: 72,
    });
    expect(repairSlot({ department_group_key: "a", department_group_id: null })).toMatchObject({
      department_group_key: "a",
    });
  });
});

describe("normalizeSlotStages", () => {
  test("CR-127 Z3b: khe duyệt kiểu cũ đã gỡ ⇒ không dựng lại khung route/finalize, giữ nguyên stage", () => {
    const stages = [review(0, "a"), review(1, "b")];
    expect(normalizeSlotStages(stages)).toEqual(stages);
  });
});

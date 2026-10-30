// CR-105 · B1/B2: bước duyệt của khe có người duyệt theo MÃ phòng ban (slot.department_group_key) ⇒ không đòi `after.group_id` khi bật.
import { describe, expect, test } from "bun:test";
import { emptyDraft, validateDraft } from "./def-form";
import type { StageDraft } from "./draft-types";
import { emptyStage } from "./stage-convert";

const review = (p: Partial<StageDraft> = {}): StageDraft => ({
  ...emptyStage(0),
  key: "s0",
  name: "Kiểm tra",
  executor: "tool",
  tool: { key: "contracts-route", args: {} },
  after: "review",
  filename: "s0.md",
  template: "x",
  sections: ["x"],
  ...p,
});
const draft = (stages: StageDraft[]) => ({
  ...emptyDraft(),
  key: "hd-a",
  name: "HĐ A",
  enabled: true,
  stages,
});
const groupErr = (d: ReturnType<typeof draft>) =>
  Object.keys(validateDraft(d, undefined, undefined, [])).filter((k) =>
    k.endsWith("after.group_id"),
  );

describe("validateDraft · bước của khe", () => {
  test("có mã phòng ban trong slot ⇒ không lỗi group; thiếu ⇒ vẫn lỗi", () => {
    expect(
      groupErr(draft([review({ slotRaw: { kind: "review", department_group_key: "pb-a" } })])),
    ).toEqual([]);
    expect(
      groupErr(draft([review({ slotRaw: { kind: "review", department_group_key: null } })])),
    ).toEqual(["stages.0.after.group_id"]);
    expect(groupErr(draft([review()]))).toEqual(["stages.0.after.group_id"]);
  });
  test("người duyệt cụ thể thay cho phòng ban", () => {
    expect(
      groupErr(draft([review({ slotRaw: { kind: "review", approver_user_id: "u1" } })])),
    ).toEqual([]);
  });
});

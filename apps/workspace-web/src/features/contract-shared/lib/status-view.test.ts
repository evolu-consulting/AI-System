import { describe, expect, test } from "bun:test";
import { effectChipOf, STATUS_TONE } from "./status-view";

describe("CR-127 U5 · chip trạng thái / hiệu lực", () => {
  test("4 trạng thái, mỗi trạng thái một sắc thái", () => {
    expect(Object.keys(STATUS_TONE).sort()).toEqual(["done", "draft", "processing", "reject"]);
    expect(STATUS_TONE.reject).toBe("late");
  });
  test("chưa DONE ⇒ không chip hiệu lực", () => {
    expect(effectChipOf({ status: "processing", effect: "active" }, null)).toBeNull();
    expect(effectChipOf({ status: "done", effect: null }, null)).toBeNull();
  });
  test("DONE sắp hết hạn ⇒ chip cam kèm số ngày; còn lại không kèm", () => {
    expect(effectChipOf({ status: "done", effect: "expiring" }, 12)).toEqual({
      effect: "expiring",
      tone: "soon",
      daysLeft: 12,
    });
    expect(effectChipOf({ status: "done", effect: "active" }, 12)?.daysLeft).toBeNull();
  });
});

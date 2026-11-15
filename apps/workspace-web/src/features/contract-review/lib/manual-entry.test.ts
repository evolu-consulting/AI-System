import { describe, expect, test } from "bun:test";
import { manualTagKey } from "./manual-entry";

describe("CR-157 manualTagKey", () => {
  test("chưa đối chiếu ⇒ cần đối chiếu", () =>
    expect(manualTagKey(false, null).key).toBe("contracts.review.manualTag.pending"));
  test("đã đối chiếu có tên ⇒ bởi X", () =>
    expect(manualTagKey(true, "An")).toEqual({
      key: "contracts.review.manualTag.doneBy",
      vars: { name: "An" },
    }));
  test("đã đối chiếu, chưa tra được tên ⇒ nhãn không tên", () =>
    expect(manualTagKey(true, null).key).toBe("contracts.review.manualTag.done"));
});

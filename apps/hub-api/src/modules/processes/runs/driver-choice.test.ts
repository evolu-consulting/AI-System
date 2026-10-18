// HUB-FR-146 · security P-d2 m2 · `driverKindOf`: stage tool thiếu `toolDriver` ⇒ `missing` (không fallback `stageDriver`).
import { describe, expect, it } from "bun:test";
import { driverKindOf } from "./driver-choice";

describe("driverKindOf · m2", () => {
  it("stage tool + có toolDriver ⇒ tool", () => {
    expect(driverKindOf(true, true)).toBe("tool");
  });
  it("stage tool + thiếu toolDriver ⇒ missing (không rơi về stage)", () => {
    expect(driverKindOf(true, false)).toBe("missing");
  });
  it("stage không phải tool ⇒ stage (có hay không toolDriver)", () => {
    expect([driverKindOf(false, true), driverKindOf(false, false)]).toEqual(["stage", "stage"]);
  });
});

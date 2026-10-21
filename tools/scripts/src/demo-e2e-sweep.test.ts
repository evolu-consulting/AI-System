import { describe, expect, it } from "bun:test";
import { assertDemo, isTagged } from "./demo-e2e-sweep";

describe("demo-e2e-sweep", () => {
  it("từ chối tenant khác demo", () => {
    expect(() => assertDemo("nitigroup")).toThrow();
    expect(() => assertDemo(undefined)).toThrow();
    expect(() => assertDemo("demo")).not.toThrow();
  });
  it("nhận thẻ E2E-DEPLOY", () => {
    expect(isTagged("E2E-DEPLOY abc")).toBe(true);
    expect(isTagged("Kế toán")).toBe(false);
  });
});

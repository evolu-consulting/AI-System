import { describe, expect, test } from "bun:test";
import { consumeSelfExit, markSelfExit, unmarkSelfExit } from "./self-exit";

describe("self-exit", () => {
  test("consume chỉ đúng một lần", () => {
    markSelfExit("r1");
    expect(consumeSelfExit("r1")).toBe(true);
    expect(consumeSelfExit("r1")).toBe(false);
  });
  test("unmark khi mutation lỗi", () => {
    markSelfExit("r2");
    unmarkSelfExit("r2");
    expect(consumeSelfExit("r2")).toBe(false);
  });
});

// TECH-DEBT #193 · dropEmptyEnv: rỗng/khoảng trắng = vắng.
import { describe, expect, test } from "bun:test";
import { dropEmptyEnv } from "./env-source";

describe("dropEmptyEnv", () => {
  test("bỏ undefined, rỗng, chỉ khoảng trắng; giữ nguyên giá trị khác", () => {
    expect(dropEmptyEnv({ A: "", B: "  ", C: undefined, D: " x ", E: "0" })).toEqual({
      D: " x ",
      E: "0",
    });
  });
});

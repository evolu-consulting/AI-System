import { describe, expect, test } from "bun:test";
import { branchParams } from "./log-params";

describe("branchParams (Nhật ký Rẽ nhánh)", () => {
  test("branch: to_step 0-based hiển thị +1, rule giữ nguyên", () => {
    expect(branchParams({ kind: "branch", to_step: 3, rule: 2 })).toEqual({ step: 4, rule: 2 });
  });
  test("kind khác ⇒ không thêm tham số", () => {
    expect(branchParams({ kind: "review", to_step: 1 })).toEqual({});
  });
});

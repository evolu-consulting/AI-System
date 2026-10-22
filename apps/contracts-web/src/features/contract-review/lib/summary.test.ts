import { describe, expect, test } from "bun:test";
import { nonEmptyRows } from "./summary";

describe("nonEmptyRows", () => {
  test("ẩn hàng chỉ có —", () => {
    expect(
      nonEmptyRows([
        ["Thưởng", "—"],
        ["Đối tác", "Cty B"],
        ["X", " "],
      ]),
    ).toEqual([["Đối tác", "Cty B"]]);
  });
});

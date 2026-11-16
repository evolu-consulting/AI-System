import { expect, test } from "bun:test";
import { cn } from "./cn";

test("cn: class sau thắng class trùng nhóm, bỏ giá trị rỗng", () => {
  expect(cn("px-2 h-9", false, "px-4")).toBe("h-9 px-4");
});

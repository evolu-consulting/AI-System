import { expect, test } from "bun:test";
import { canC } from "./c.rules";

test("c", () => {
  expect(canC(1)).toBe(true);
});

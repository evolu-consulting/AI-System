import { describe, expect, test } from "bun:test";
import { cn } from "./utils";

describe("ADM-NFR-06 · cn()", () => {
  test("class Tailwind sau thắng class trước", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
  });

  test("bỏ giá trị falsy", () => {
    const off = false;
    expect(cn("a", off && "b")).toBe("a");
  });
});

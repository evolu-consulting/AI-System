// P-b · parseRef chịu tiền tố danh sách của LLM. [HUB-FR-122]
import { describe, expect, test } from "bun:test";
import { parseRef } from "./sources.rules";

describe("parseRef list prefix", () => {
  const want = { key: "ai-system-local", path: "apps/x.ts", version: "abc" };
  for (const p of ["", "- ", "* ", "• ", "1. ", "12) "])
    test(`prefix '${p}'`, () =>
      expect(parseRef(`${p}ai-system-local:apps/x.ts@abc`)).toEqual(want));
  test("invalid", () => {
    expect(parseRef("- không hợp lệ")).toBeNull();
    expect(parseRef("-ai:x@v")?.key).toBe("-ai");
  });
});

import { describe, expect, test } from "bun:test";
import { checkSecretDelete, secretLast4 } from "./secrets.rules";

describe("ADM-FR-50 · secrets.rules", () => {
  test("ADM-FR-50 · secretLast4 theo code point", () => {
    expect(secretLast4("abcdefgh")).toBe("efgh");
    expect(secretLast4("ab😀😀cd")).toBe("😀😀cd");
  });

  test("ADM-FR-50 · M2-R05 · checkSecretDelete", () => {
    expect(checkSecretDelete([])).toBeNull();
    expect(checkSecretDelete(["a-b"])).toEqual({
      code: "SECRET_IN_USE",
      details: { used_by: ["a-b"] },
    });
  });
});

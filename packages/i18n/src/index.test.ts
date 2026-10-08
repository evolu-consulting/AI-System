import { describe, expect, test } from "bun:test";
import { DEFAULT_LOCALE, resources, SUPPORTED_LOCALES } from "./index";

const flat = (obj: unknown, prefix = ""): string[] =>
  typeof obj === "object" && obj !== null
    ? Object.entries(obj).flatMap(([k, v]) => flat(v, prefix ? `${prefix}.${k}` : k))
    : [prefix];

describe("ADM-NFR-06 · @ai/i18n", () => {
  test("mặc định en, hỗ trợ vi và en", () => {
    expect(DEFAULT_LOCALE).toBe("en");
    expect([...SUPPORTED_LOCALES]).toEqual(["vi", "en"]);
  });

  test("vi và en cùng tập key phẳng", () => {
    expect(flat(resources.en.translation).sort()).toEqual(flat(resources.vi.translation).sort());
  });
});

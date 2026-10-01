// ADM-FR-20, ADM-FR-30 · pickLocalized: theo ngôn ngữ, thiếu EN → VI.
import { describe, expect, test } from "bun:test";
import { pickLocalized } from "./localized";

describe("ADM-FR-30 · pickLocalized", () => {
  test("vi → VI; en → EN nếu có", () => {
    expect(pickLocalized({ vi: "Kế toán", en: "Accounting" }, "vi")).toBe("Kế toán");
    expect(pickLocalized({ vi: "Kế toán", en: "Accounting" }, "en")).toBe("Accounting");
    expect(pickLocalized({ vi: "Kế toán", en: "Accounting" }, "en-US")).toBe("Accounting");
  });

  test("thiếu hoặc rỗng EN → VI", () => {
    expect(pickLocalized({ vi: "Kế toán" }, "en")).toBe("Kế toán");
    expect(pickLocalized({ vi: "Kế toán", en: "  " }, "en")).toBe("Kế toán");
  });
});

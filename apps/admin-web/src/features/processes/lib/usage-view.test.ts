// ADM-FR-67 · P-a F5: test hàm thuần tab Token.
import { describe, expect, test } from "bun:test";
import { cacheOf, formatSeconds, formatTokens, modelLabel, roleKey } from "./usage-view";

describe("usage-view", () => {
  test("cache = đọc + ghi", () => {
    expect(
      cacheOf({ input: 1, output: 2, cache_read: 3, cache_write: 4, total: 10, calls: 1 }),
    ).toBe(7);
  });
  test("số theo ngôn ngữ, giây một chữ số", () => {
    expect(formatTokens(1234, "vi")).toBe(new Intl.NumberFormat("vi").format(1234));
    expect(formatSeconds(null, "vi")).toBe("—");
    expect(formatSeconds(12_000, "en")).toBe("12.0s");
  });
  test("vai lạ ⇒ agent; model null ⇒ —", () => {
    expect(roleKey("plan")).toBe("process.usage.role.plan");
    expect(roleKey("agent")).toBe("process.usage.role.agent");
    expect(modelLabel(null)).toBe("—");
    expect(modelLabel("sonnet")).toBe("sonnet");
  });
});

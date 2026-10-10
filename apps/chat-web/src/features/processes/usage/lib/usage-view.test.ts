import { describe, expect, test } from "bun:test";
import { cacheOf, modelLabel, roleKey } from "./usage-view";

describe("usage-view · CHAT-AC-58", () => {
  test("Cache = đọc + ghi", () => {
    expect(
      cacheOf({ input: 1, output: 2, cache_read: 30, cache_write: 4, total: 37, calls: 1 }),
    ).toBe(34);
  });
  test("nhãn vai + model null ⇒ —", () => {
    expect(roleKey("plan")).toBe("process.usage.role.plan");
    expect(roleKey("member")).toBe("process.usage.role.member");
    expect(roleKey("agent")).toBe("process.usage.role.agent");
    expect(modelLabel(null)).toBe("—");
    expect(modelLabel("fake-1")).toBe("fake-1");
  });
});

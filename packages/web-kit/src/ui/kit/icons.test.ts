// CR-177 U4 · mọi khái niệm là component lucide hợp lệ, không hai khái niệm dùng chung một icon.
import { describe, expect, test } from "bun:test";
import { ICONS } from "./icons";

describe("ICONS", () => {
  const entries = Object.entries(ICONS);
  test("mọi giá trị là component lucide (forwardRef có displayName)", () => {
    for (const [k, v] of entries) {
      const c = v as unknown as { $$typeof?: symbol; render?: unknown; displayName?: string };
      expect(typeof c.displayName, k).toBe("string");
      expect(c.$$typeof, k).toBeDefined();
    }
  });
  test("không trùng icon giữa các khái niệm", () => {
    const seen = new Map<unknown, string>();
    for (const [k, v] of entries) {
      expect(seen.get(v), `${k} trùng ${seen.get(v)}`).toBeUndefined();
      seen.set(v, k);
    }
  });
});

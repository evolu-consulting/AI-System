import { describe, expect, test } from "bun:test";
import { contentLocked, LOCKED_LEGAL_KEYS, lockErrorKey, lockView } from "./lock-view";

describe("CR-127 U5 · khoá nội dung theo trạng thái", () => {
  test("chỉ DRAFT là form; PROCESSING/DONE/REJECT chữ đọc", () => {
    expect(contentLocked("draft")).toBe(false);
    for (const s of ["processing", "done", "reject"] as const) expect(contentLocked(s)).toBe(true);
  });
  test("khoá ⇒ mọi ô chỉ đọc; DRAFT ⇒ không khoá ô nào", () => {
    expect(lockView({ status: "done" }).lockedKeys).toBe(LOCKED_LEGAL_KEYS);
    expect(lockView({ status: "draft" }).lockedKeys).toBeUndefined();
  });
  test("lỗi: USE_NEW_VERSION nói cách khắc phục", () => {
    expect(lockErrorKey(409, "USE_NEW_VERSION")).toBe("contracts.u5.err.USE_NEW_VERSION");
    expect(lockErrorKey(403, undefined)).toBe("contracts.lock.errForbidden");
    expect(lockErrorKey(500, undefined)).toBeNull();
  });
});

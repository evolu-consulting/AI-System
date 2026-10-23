// CR-097 K3a · HD-FR-100 · HD-FR-104: luật thuần màn khoá.
import { describe, expect, test } from "bun:test";
import { LOCKED_LEGAL_KEYS, lockErrorKey, lockView } from "./lock-view";

const base = { locked: false, status: "active", has_document: true } as const;

describe("HD-FR-100 lockView", () => {
  test("khoá ⇒ banner locked, ô pháp lý chỉ đọc, notice_days còn sửa", () => {
    const v = lockView({ ...base, locked: true }, false);
    expect(v.banner).toBe("locked");
    expect(v.lockedKeys?.has("total_value")).toBe(true);
    expect(v.lockedKeys?.has("commission_pct")).toBe(true);
    expect(v.lockedKeys?.has("notice_days")).toBe(false);
    expect(LOCKED_LEGAL_KEYS.has("title")).toBe(true);
  });
  test("HD-FR-104 chỉ owner thấy mở lại, và chỉ khi khoá", () => {
    expect(lockView({ ...base, locked: true }, true).canReopen).toBe(true);
    expect(lockView({ ...base, locked: true }, false).canReopen).toBe(false);
    expect(lockView({ ...base, status: "needs_review" }, true).canReopen).toBe(false);
  });
  test("Chờ duyệt ⇒ banner pending, không khoá ô", () => {
    const v = lockView({ ...base, status: "needs_review" }, true);
    expect(v.banner).toBe("pending");
    expect(v.lockedKeys).toBeUndefined();
  });
  test("không khoá, không chờ duyệt ⇒ không banner; thiếu văn bản ⇒ noDocument", () => {
    expect(lockView(base, false).banner).toBeNull();
    expect(lockView({ ...base, has_document: false }, false).noDocument).toBe(true);
  });
  test("lockErrorKey map CONTRACT_LOCKED / 403", () => {
    expect(lockErrorKey(409, "CONTRACT_LOCKED")).toBe("contracts.lock.errLocked");
    expect(lockErrorKey(409, "CONTRACT_NOT_LOCKED")).toBe("contracts.lock.errNotLocked");
    expect(lockErrorKey(403, "FORBIDDEN")).toBe("contracts.lock.errForbidden");
    expect(lockErrorKey(500, undefined)).toBeNull();
  });
});

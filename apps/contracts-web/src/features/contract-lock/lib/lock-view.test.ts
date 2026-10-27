// CR-097 K3a · HD-FR-100 · HD-FR-104: luật thuần màn khoá.
import { describe, expect, test } from "bun:test";
import { LOCKED_LEGAL_KEYS, lockErrorKey, lockView, reopenRight } from "./lock-view";

const base = { locked: false, status: "active", has_document: true } as const;

describe("HD-FR-100 lockView", () => {
  test("khoá ⇒ banner locked, mọi ô chỉ đọc (cả notice_days)", () => {
    const v = lockView({ ...base, locked: true }, false);
    expect(v.banner).toBe("locked");
    expect(v.lockedKeys?.has("total_value")).toBe(true);
    expect(v.lockedKeys?.has("commission_pct")).toBe(true);
    expect(v.lockedKeys?.has("notice_days")).toBe(true);
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
    expect(lockErrorKey(410, "USE_VERSIONS")).toBe("contracts.lock.errUseVersions");
  });
});

describe("CR-101a reopenRight — owner gói hoặc người phụ trách", () => {
  const c = { owner_user_id: "u1" };
  test("ma trận", () => {
    expect(reopenRight(c, { owner: true, write: true, userId: "u9" })).toBe(true);
    expect(reopenRight(c, { owner: false, write: true, userId: "u1" })).toBe(true);
    expect(reopenRight(c, { owner: false, write: true, userId: "u9" })).toBe(false);
    expect(reopenRight(c, { owner: false, write: false, userId: "u1" })).toBe(false);
    expect(reopenRight({ owner_user_id: null }, { owner: false, write: true, userId: null })).toBe(
      false,
    );
  });
});

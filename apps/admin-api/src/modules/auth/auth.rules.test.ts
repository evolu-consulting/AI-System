// ADM-FR-01, ADM-FR-02, ADM-FR-07 · biên của luật auth (plan M1 §8).
import { describe, expect, test } from "bun:test";
import {
  afterFailedLogin,
  classifyRefresh,
  clearExpiredLock,
  generateTempPassword,
  isTempLocked,
  MAX_LOGIN_ATTEMPTS,
  TEMP_LOCK_MS,
} from "./auth.rules";

const NOW = new Date("2026-10-01T09:00:00.000Z");

describe("ADM-FR-07 · bộ đếm khoá tạm", () => {
  test("ADM-FR-07 · 4 lần sai chưa khoá; lần 5 khoá đúng 15 phút; hết hạn đúng mốc", () => {
    let s = { failedLogins: 0, lockedUntil: null as Date | null };
    for (let i = 1; i < MAX_LOGIN_ATTEMPTS; i++) {
      s = afterFailedLogin(s.failedLogins, NOW);
      expect(s).toEqual({ failedLogins: i, lockedUntil: null });
    }
    s = afterFailedLogin(s.failedLogins, NOW);
    expect(s.lockedUntil?.getTime()).toBe(NOW.getTime() + TEMP_LOCK_MS);
    expect(isTempLocked(s.lockedUntil, NOW)).toBe(true);
    const at = new Date(NOW.getTime() + TEMP_LOCK_MS);
    expect(isTempLocked(s.lockedUntil, at)).toBe(false);
    expect(clearExpiredLock(s, at)).toEqual({ failedLogins: 0, lockedUntil: null });
  });
});

describe("ADM-FR-02 · classifyRefresh", () => {
  const base = { revokedAt: null, revokedReason: null, expiresAt: new Date(NOW.getTime() - 1) };
  test("ADM-FR-02 · đã thu hồi thắng hết hạn", () => {
    expect(classifyRefresh(base, NOW)).toBe("expired");
    const rotated = { ...base, revokedAt: NOW, revokedReason: "rotated" as const };
    expect(classifyRefresh(rotated, NOW)).toBe("superseded");
    const out = { ...base, revokedAt: NOW, revokedReason: "logout" as const };
    expect(classifyRefresh(out, NOW)).toBe("reuse");
  });
});

describe("ADM-NFR-01 · generateTempPassword", () => {
  test("ADM-NFR-01 · lượt đầu toàn byte bị loại vẫn ra đủ 16 ký tự ở lượt sau", () => {
    let call = 0;
    const rng = (n: number) => new Uint8Array(n).fill(call++ === 0 ? 255 : 1);
    expect(generateTempPassword(rng)).toBe("B".repeat(16));
    expect(call).toBe(2);
  });
});

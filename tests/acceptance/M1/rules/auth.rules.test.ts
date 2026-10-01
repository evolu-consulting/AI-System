// ADM-FR-01, ADM-FR-02, ADM-FR-06, ADM-FR-07, ADM-NFR-01 · luật thuần auth (plan.md §4 `auth.rules.ts`).
import { describe, expect, it, spyOn } from "bun:test";
import { loadAuthRules } from "../_modules";

const NOW = new Date("2026-10-01T09:00:00.000Z");
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs);

/** RNG giả: trả lần lượt các byte của `seq` (lặp vòng), mỗi lần gọi `n` byte kế tiếp. */
function streamRng(seq: number[]) {
  let i = 0;
  return (n: number): Uint8Array => {
    const out = new Uint8Array(n);
    for (let k = 0; k < n; k++) out[k] = seq[i++ % seq.length] ?? 0;
    return out;
  };
}

describe("ADM-FR-07 · hằng số auth", () => {
  it("ADM-FR-07 · M1-R03 · hằng số khoá tạm, TTL token, ân hạn refresh đúng spec", async () => {
    const r = await loadAuthRules();
    expect(r.MAX_LOGIN_ATTEMPTS).toBe(5);
    expect(r.TEMP_LOCK_MS).toBe(900_000);
    expect(r.ACCESS_TOKEN_TTL_S).toBe(900);
    expect(r.REFRESH_TOKEN_TTL_S).toBe(2_592_000);
    expect(r.CHANGE_TOKEN_TTL_S).toBe(300);
    expect(r.REFRESH_GRACE_MS).toBe(10_000);
  });
});

describe("ADM-FR-01 · chuẩn hoá định danh đăng nhập", () => {
  it("ADM-FR-01 · M1-R01 · normalizeLoginId trim + lowercase", async () => {
    const r = await loadAuthRules();
    expect(r.normalizeLoginId("  ACMe ")).toBe("acme");
  });
});

describe("ADM-FR-07 · khoá tạm", () => {
  it("ADM-FR-07 · M1-R03 · isTempLocked: null/bằng now/quá khứ → false; sau now 1 ms → true", async () => {
    const r = await loadAuthRules();
    expect(r.isTempLocked(null, NOW)).toBe(false);
    expect(r.isTempLocked(at(1), NOW)).toBe(true);
    expect(r.isTempLocked(at(0), NOW)).toBe(false);
    expect(r.isTempLocked(at(-1), NOW)).toBe(false);
  });

  it("ADM-FR-07 · M1-R03 · clearExpiredLock: hết hạn (<= now) về {0,null}; còn hạn và chưa khoá giữ nguyên", async () => {
    const r = await loadAuthRules();
    expect(r.clearExpiredLock({ failedLogins: 4, lockedUntil: at(0) }, NOW)).toEqual({
      failedLogins: 0,
      lockedUntil: null,
    });
    expect(r.clearExpiredLock({ failedLogins: 2, lockedUntil: at(-5000) }, NOW)).toEqual({
      failedLogins: 0,
      lockedUntil: null,
    });
    expect(r.clearExpiredLock({ failedLogins: 1, lockedUntil: at(1) }, NOW)).toEqual({
      failedLogins: 1,
      lockedUntil: at(1),
    });
    expect(r.clearExpiredLock({ failedLogins: 3, lockedUntil: null }, NOW)).toEqual({
      failedLogins: 3,
      lockedUntil: null,
    });
  });

  it("ADM-FR-07 · AC-A01 · afterFailedLogin: 0→1, 3→4; lần thứ 5 → {0, now+15 phút} chính xác theo ms", async () => {
    const r = await loadAuthRules();
    expect(r.afterFailedLogin(0, NOW)).toEqual({ failedLogins: 1, lockedUntil: null });
    expect(r.afterFailedLogin(3, NOW)).toEqual({ failedLogins: 4, lockedUntil: null });
    const fifth = r.afterFailedLogin(4, NOW);
    expect(fifth.failedLogins).toBe(0);
    expect(fifth.lockedUntil.getTime()).toBe(NOW.getTime() + 900_000);
  });
});

describe("ADM-FR-01 · quyết định đăng nhập", () => {
  it("ADM-FR-01 · M1-R04 · canSignIn: chỉ (active, !lockedByTenant, tenantActive) mới true", async () => {
    const r = await loadAuthRules();
    for (const active of [true, false]) {
      for (const lockedByTenant of [true, false]) {
        for (const tenantActive of [true, false]) {
          const want = active && !lockedByTenant && tenantActive;
          expect(r.canSignIn({ active, lockedByTenant }, tenantActive)).toBe(want);
        }
      }
    }
  });

  it("ADM-FR-06 · M1-R05 · outcomeAfterPasswordOk: khoá thắng mustChangePassword; mustChange → password_change_required", async () => {
    const r = await loadAuthRules();
    const ok = { active: true, lockedByTenant: false, mustChangePassword: false };
    expect(r.outcomeAfterPasswordOk({ ...ok, active: false, mustChangePassword: true }, true)).toBe(
      "account_locked",
    );
    expect(
      r.outcomeAfterPasswordOk({ ...ok, lockedByTenant: true, mustChangePassword: true }, true),
    ).toBe("account_locked");
    expect(r.outcomeAfterPasswordOk({ ...ok, mustChangePassword: true }, false)).toBe(
      "account_locked",
    );
    expect(r.outcomeAfterPasswordOk({ ...ok, mustChangePassword: true }, true)).toBe(
      "password_change_required",
    );
    expect(r.outcomeAfterPasswordOk(ok, true)).toBe("authenticated");
  });
});

describe("ADM-FR-02 · phân loại refresh token", () => {
  const live = { revokedAt: null, revokedReason: null, expiresAt: at(60_000) };

  it("ADM-FR-02 · M1-R07 · classifyRefresh: valid, và expired khi expiresAt <= now", async () => {
    const r = await loadAuthRules();
    expect(r.classifyRefresh(live, NOW)).toBe("valid");
    expect(r.classifyRefresh({ ...live, expiresAt: at(0) }, NOW)).toBe("expired");
    expect(r.classifyRefresh({ ...live, expiresAt: at(-1) }, NOW)).toBe("expired");
  });

  it("ADM-FR-02 · M1-R07 · classifyRefresh: rotated trong ân hạn 10 s (0 ms và đúng 10000 ms) → superseded", async () => {
    const r = await loadAuthRules();
    for (const age of [0, 10_000]) {
      const t = { ...live, revokedAt: at(-age), revokedReason: "rotated" };
      expect(r.classifyRefresh(t, NOW)).toBe("superseded");
    }
  });

  it("ADM-FR-02 · M1-AC04 · classifyRefresh: rotated quá 10 s (10001 ms) → reuse", async () => {
    const r = await loadAuthRules();
    const t = { ...live, revokedAt: at(-10_001), revokedReason: "rotated" };
    expect(r.classifyRefresh(t, NOW)).toBe("reuse");
  });

  it("ADM-FR-02 · M1-R07 · classifyRefresh: mọi lý do thu hồi khác → reuse, kể cả trong 1 s", async () => {
    const r = await loadAuthRules();
    const reasons = [
      "logout",
      "reuse",
      "logout_all",
      "user_locked",
      "tenant_locked",
      "password_changed",
      "password_reset",
    ];
    for (const revokedReason of reasons) {
      const t = { ...live, revokedAt: at(-1000), revokedReason };
      expect(r.classifyRefresh(t, NOW)).toBe("reuse");
    }
  });
});

describe("ADM-FR-06 · mật khẩu", () => {
  it("ADM-FR-06 · M1-R06 · isAcceptableNewPassword: 10–128 ký tự", async () => {
    const r = await loadAuthRules();
    expect(r.isAcceptableNewPassword("")).toBe(false);
    expect(r.isAcceptableNewPassword("a".repeat(9))).toBe(false);
    expect(r.isAcceptableNewPassword("a".repeat(10))).toBe(true);
    expect(r.isAcceptableNewPassword("a".repeat(128))).toBe(true);
    expect(r.isAcceptableNewPassword("a".repeat(129))).toBe(false);
  });

  it("ADM-FR-06 · M1-R17 · TEMP_PASSWORD_ALPHABET gồm đúng 62 ký tự khác nhau [A-Za-z0-9]", async () => {
    const r = await loadAuthRules();
    const a: string = r.TEMP_PASSWORD_ALPHABET;
    expect(a).toMatch(/^[A-Za-z0-9]{62}$/);
    expect(new Set(a).size).toBe(62);
  });

  it("ADM-FR-06 · M1-R17 · generateTempPassword: 16 ký tự, ánh xạ ALPHABET[byte % 62] theo thứ tự byte", async () => {
    const r = await loadAuthRules();
    const A: string = r.TEMP_PASSWORD_ALPHABET;
    const bytes = [61, 62, 123, 124, 185, 186, 247, 0, 1, 2, 3, 4, 5, 6, 7, 8];
    const pw: string = r.generateTempPassword(streamRng(bytes));
    expect(pw).toHaveLength(16);
    expect(pw).toBe(bytes.map((b) => A[b % 62]).join(""));
  });

  it("ADM-FR-06 · M1-R17 · generateTempPassword: byte >= 248 bị loại, kết quả giống dãy đã bỏ chúng", async () => {
    const r = await loadAuthRules();
    const clean = Array.from({ length: 40 }, (_, i) => (i * 7) % 248);
    const dirty = clean.flatMap((b, i) => [248 + (i % 8), b]);
    const a: string = r.generateTempPassword(streamRng(clean));
    const b: string = r.generateTempPassword(streamRng(dirty));
    expect(b).toBe(a);
    expect(a).toMatch(/^[A-Za-z0-9]{16}$/);
  });

  it("ADM-FR-06 · M1-R17 · generateTempPassword: hai dãy RNG khác nhau → hai mật khẩu khác nhau", async () => {
    const r = await loadAuthRules();
    const a: string = r.generateTempPassword(streamRng(Array.from({ length: 64 }, (_, i) => i)));
    const b: string = r.generateTempPassword(
      streamRng(Array.from({ length: 64 }, (_, i) => 100 + i)),
    );
    expect(a).not.toBe(b);
  });

  it("ADM-FR-06 · ADM-NFR-01 · generateTempPassword không dùng nguồn ngẫu nhiên nào ngoài randomBytes truyền vào", async () => {
    const r = await loadAuthRules();
    const math = spyOn(Math, "random");
    const web = spyOn(crypto, "getRandomValues");
    try {
      r.generateTempPassword(streamRng(Array.from({ length: 64 }, (_, i) => i)));
      expect(math).not.toHaveBeenCalled();
      expect(web).not.toHaveBeenCalled();
    } finally {
      math.mockRestore();
      web.mockRestore();
    }
  });

  it("ADM-FR-06 · M1-R05 · changeTokenMatches: so khớp đúng epoch ms của password_changed_at", async () => {
    const r = await loadAuthRules();
    const d = new Date("2026-09-30T08:00:00.123Z");
    expect(r.changeTokenMatches(d.getTime(), d)).toBe(true);
    expect(r.changeTokenMatches(d.getTime() + 1, d)).toBe(false);
  });
});

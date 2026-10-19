// L1 (TECH-DEBT #224) · luật giới hạn đăng nhập (thuần): ngưỡng, backoff, cửa sổ IP, khoá Redis không lộ tên.
import { describe, expect, test } from "bun:test";
import {
  type AccountState,
  accountId,
  afterAccountFail,
  EMPTY_ACCOUNT,
  ipId,
  ipWindow,
  lockDurationMs,
  DEFAULT_LIMIT_POLICY as P,
  retryAfterS,
} from "./limit.rules";

const MIN = 60_000;
const T0 = Date.UTC(2026, 9, 20, 5, 0, 0);

function failN(s: AccountState, n: number, now: number) {
  let cur = s;
  let lock: number | null = null;
  for (let i = 0; i < n; i++) {
    const o = afterAccountFail(cur, now);
    cur = o.state;
    lock = o.newLockUntil ?? lock;
  }
  return { state: cur, lock };
}

describe("L1 · chính sách mặc định", () => {
  test("5 lần sai / khoá 15' (giống M1), IP 30 lượt / 10', backoff trần 4h, bậc về 0 sau 24h", () => {
    expect(P).toEqual({
      accountMaxFails: 5,
      accountLockBaseMs: 15 * MIN,
      accountLockMaxMs: 240 * MIN,
      strikeResetMs: 24 * 60 * MIN,
      ipMaxAttempts: 30,
      ipWindowMs: 10 * MIN,
    });
  });

  test("lockDurationMs: 15' → 30' → 60' → 120' → 240' → trần 240'", () => {
    expect([1, 2, 3, 4, 5, 6, 50].map((s) => lockDurationMs(s) / MIN)).toEqual([
      15, 30, 60, 120, 240, 240, 240,
    ]);
    expect(lockDurationMs(0)).toBe(15 * MIN);
  });
});

describe("L1 · afterAccountFail", () => {
  test("lần 1–4 chỉ đếm; lần 5 khoá now+15', đếm về 0, bậc 1", () => {
    const four = failN(EMPTY_ACCOUNT, 4, T0);
    expect(four.lock).toBeNull();
    expect(four.state.fails).toBe(4);
    const o = afterAccountFail(four.state, T0);
    expect(o.newLockUntil).toBe(T0 + 15 * MIN);
    expect(o.state).toEqual({ fails: 0, strikes: 1, lockedUntil: T0 + 15 * MIN, lastLockAt: T0 });
  });

  test("đang khoá ⇒ không đổi gì, không khoá mới", () => {
    const locked = failN(EMPTY_ACCOUNT, 5, T0).state;
    const o = afterAccountFail(locked, T0 + MIN);
    expect(o).toEqual({ state: locked, newLockUntil: null });
  });

  test("backoff: hết khoá rồi sai 5 lần nữa ⇒ 30', rồi 60'", () => {
    const a = failN(EMPTY_ACCOUNT, 5, T0);
    const t1 = T0 + 16 * MIN;
    const b = failN(a.state, 5, t1);
    expect(b.lock).toBe(t1 + 30 * MIN);
    const t2 = t1 + 31 * MIN;
    expect(failN(b.state, 5, t2).lock).toBe(t2 + 60 * MIN);
  });

  test("không bị khoá thêm > 24h ⇒ bậc về 0 (khoá lại 15')", () => {
    const a = failN(failN(EMPTY_ACCOUNT, 5, T0).state, 5, T0 + 16 * MIN);
    const late = T0 + 16 * MIN + 25 * 60 * MIN;
    expect(failN(a.state, 5, late).lock).toBe(late + 15 * MIN);
  });
});

describe("L1 · cửa sổ IP và Retry-After", () => {
  test("ipWindow: cửa sổ cố định 10', resetAt = đầu cửa sổ kế", () => {
    const w = ipWindow(T0 + 3 * MIN + 5);
    expect(w.resetAt - w.slot * P.ipWindowMs).toBe(P.ipWindowMs);
    expect(w.resetAt).toBeGreaterThan(T0 + 3 * MIN);
    expect(ipWindow(w.resetAt).slot).toBe(w.slot + 1);
  });

  test("retryAfterS làm tròn lên, tối thiểu 1", () => {
    expect(retryAfterS(T0 + 1500, T0)).toBe(2);
    expect(retryAfterS(T0, T0)).toBe(1);
    expect(retryAfterS(T0 - 9, T0)).toBe(1);
  });
});

describe("L1 · định danh khoá", () => {
  test("accountId: sha256 hex, không chứa tên, tách tenant/username bằng NUL", () => {
    const a = accountId("acme", "an");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toContain("acme");
    expect(accountId("acme", "an")).toBe(a);
    expect(accountId("acmea", "n")).not.toBe(a);
    expect(accountId("globex", "an")).not.toBe(a);
  });

  test("ipId: IPv4/IPv6 giữ nguyên (thường hoá), rỗng/lạ ⇒ 'unknown'", () => {
    expect(ipId("203.0.113.7")).toBe("203.0.113.7");
    expect(ipId(" 2001:DB8::1 ")).toBe("2001:db8::1");
    expect(ipId("::ffff:10.0.0.1")).toBe("::ffff:10.0.0.1");
    expect(ipId(null)).toBe("unknown");
    expect(ipId("")).toBe("unknown");
    expect(ipId("1.2.3.4\r\nX: y")).toBe("unknown");
    expect(ipId("a".repeat(65))).toBe("unknown");
  });
});

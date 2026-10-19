// L1 (TECH-DEBT #224) · ánh xạ kết quả bộ đếm ⇒ lỗi HTTP: 429 RATE_LIMITED (+Retry-After), 423 TEMP_LOCKED, Redis lỗi ⇒ 503.
import { describe, expect, test } from "bun:test";
import { AUTH_LIMIT_ERRORS, RateLimitedDetailsSchema } from "@ai/contracts";
import { AppError } from "../../../lib/errors";
import { Semaphore } from "../../../lib/semaphore";
import type { LoginLimiter, PreCheck } from "./limit.redis";
import { DEFAULT_LIMIT_POLICY } from "./limit.rules";
import { checkIp, checkLogin, hashSlot, recordLoginSuccess } from "./limit.service";

const NOW = new Date("2026-10-20T05:00:00.000Z");

function fake(pre: () => Promise<PreCheck>): LoginLimiter & { seen: unknown[] } {
  const seen: unknown[] = [];
  return {
    seen,
    policy: DEFAULT_LIMIT_POLICY,
    pre: (ip, account, now) => {
      seen.push({ ip, account, now });
      return pre();
    },
    fail: () => Promise.resolve(null),
    success: () => Promise.reject(new Error("ECONNREFUSED")),
    clear: () => Promise.resolve(false),
  };
}

async function caught(p: Promise<unknown>): Promise<AppError> {
  try {
    await p;
  } catch (err) {
    if (err instanceof AppError) return err;
    throw err;
  }
  throw new Error("không ném");
}

describe("L1 · contract bổ sung", () => {
  test("AUTH_LIMIT_ERRORS = RATE_LIMITED 429 + AUTH_UNAVAILABLE 503; details 429 strict", () => {
    expect(AUTH_LIMIT_ERRORS).toEqual({ RATE_LIMITED: 429, AUTH_UNAVAILABLE: 503 });
    expect(RateLimitedDetailsSchema.parse({ retry_after_s: 3 })).toEqual({ retry_after_s: 3 });
    expect(RateLimitedDetailsSchema.safeParse({ retry_after_s: 0 }).success).toBe(false);
    expect(RateLimitedDetailsSchema.safeParse({ retry_after_s: 1, x: 1 }).success).toBe(false);
  });
});

describe("L1 · checkLogin / checkIp", () => {
  test("ok ⇒ không ném; IP lạ ⇒ xô 'unknown'", async () => {
    const l = fake(async () => ({ kind: "ok" }));
    await checkLogin(l, null, "acct", NOW);
    expect(l.seen).toEqual([{ ip: "unknown", account: "acct", now: NOW.getTime() }]);
  });

  test("ip_limited ⇒ 429 RATE_LIMITED, Retry-After = giây tới hết cửa sổ, details khớp schema", async () => {
    const l = fake(async () => ({ kind: "ip_limited", resetAt: NOW.getTime() + 61_500 }));
    for (const p of [checkLogin(l, "1.2.3.4", "a", NOW), checkIp(l, "1.2.3.4", NOW)]) {
      const e = await caught(p);
      expect([e.code, e.status]).toEqual(["RATE_LIMITED", 429]);
      expect(RateLimitedDetailsSchema.parse(e.details)).toEqual({ retry_after_s: 62 });
      expect(e.headers).toEqual({ "Retry-After": "62" });
    }
  });

  test("locked ⇒ 423 TEMP_LOCKED {until} (contract M1); checkIp bỏ qua khoá tài khoản", async () => {
    const until = NOW.getTime() + 15 * 60_000;
    const l = fake(async () => ({ kind: "locked", until }));
    const e = await caught(checkLogin(l, "1.2.3.4", "a", NOW));
    expect([e.code, e.status, e.details]).toEqual([
      "TEMP_LOCKED",
      423,
      { until: new Date(until).toISOString() },
    ]);
    await checkIp(l, "1.2.3.4", NOW);
  });

  test("Redis lỗi ⇒ 503 AUTH_UNAVAILABLE + Retry-After (đóng an toàn)", async () => {
    const l = fake(() => Promise.reject(new Error("Stream isn't writeable")));
    for (const p of [checkLogin(l, "1.2.3.4", "a", NOW), recordLoginSuccess(l, "a")]) {
      const e = await caught(p);
      expect([e.code, e.status]).toEqual(["AUTH_UNAVAILABLE", 503]);
      expect(e.headers?.["Retry-After"]).toMatch(/^\d+$/);
    }
  });
});

describe("L1 · hashSlot", () => {
  test("hàng đợi đầy ⇒ 503 AUTH_UNAVAILABLE Retry-After 1; không semaphore ⇒ chạy thẳng", async () => {
    const s = new Semaphore(1, 0);
    let open!: () => void;
    const hold = hashSlot(s, () => new Promise<void>((r) => (open = r)));
    const e = await caught(hashSlot(s, async () => 1));
    expect([e.code, e.status, e.headers]).toEqual([
      "AUTH_UNAVAILABLE",
      503,
      { "Retry-After": "1" },
    ]);
    open();
    await hold;
    expect(await hashSlot(undefined, async () => 2)).toBe(2);
  });
});

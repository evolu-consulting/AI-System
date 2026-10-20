// L1 (TECH-DEBT #224) · ánh xạ kết quả bộ đếm ⇒ lỗi HTTP: 429 RATE_LIMITED (+Retry-After), 423 TEMP_LOCKED, Redis lỗi ⇒ 503.
// L1c (A-3): lượt giữ chỗ — `busy` ⇒ 429; fail/ok kết thúc lượt, release chỉ nhả khi lượt chưa kết thúc.
import { describe, expect, test } from "bun:test";
import { AUTH_LIMIT_ERRORS, RateLimitedDetailsSchema } from "@ai/contracts";
import type { Db } from "@ai/db";
import { AppError } from "../../../lib/errors";
import { Semaphore } from "../../../lib/semaphore";
import type { LoginLimiter, PreCheck } from "./limit.redis";
import { DEFAULT_LIMIT_POLICY } from "./limit.rules";
import { checkIp, hashSlot, openLoginSlot } from "./limit.service";

const NOW = new Date("2026-10-20T05:00:00.000Z");

type Fake = LoginLimiter & { seen: unknown[]; calls: string[] };
function fake(pre: () => Promise<PreCheck>, o: { successFails?: boolean } = {}): Fake {
  const seen: unknown[] = [];
  const calls: string[] = [];
  return {
    seen,
    calls,
    policy: DEFAULT_LIMIT_POLICY,
    pre: (ip, account, now, token) => {
      seen.push({ ip, account, now, token: typeof token });
      return pre();
    },
    fail: async () => {
      calls.push("fail");
      return null;
    },
    success: async () => {
      calls.push("success");
      if (o.successFails) throw new Error("ECONNREFUSED");
    },
    release: async () => {
      calls.push("release");
    },
    clear: () => Promise.resolve(false),
  };
}
const open = (l: LoginLimiter, ip: string | null = "1.2.3.4") =>
  openLoginSlot({ db: {} as Db, limiter: l }, ip, "acct", NOW);

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

describe("L1 · openLoginSlot / checkIp", () => {
  test("ok ⇒ không ném, giữ chỗ bằng token; IP lạ ⇒ xô 'unknown'", async () => {
    const l = fake(async () => ({ kind: "ok" }));
    await open(l, null);
    expect(l.seen).toEqual([
      { ip: "unknown", account: "acct", now: NOW.getTime(), token: "string" },
    ]);
  });

  test("ip_limited ⇒ 429 RATE_LIMITED, Retry-After = giây tới hết cửa sổ, details khớp schema", async () => {
    const l = fake(async () => ({ kind: "ip_limited", resetAt: NOW.getTime() + 61_500 }));
    for (const p of [open(l), checkIp(l, "1.2.3.4", NOW)]) {
      const e = await caught(p);
      expect([e.code, e.status]).toEqual(["RATE_LIMITED", 429]);
      expect(RateLimitedDetailsSchema.parse(e.details)).toEqual({ retry_after_s: 62 });
      expect(e.headers).toEqual({ "Retry-After": "62" });
    }
  });

  test("locked ⇒ 423 TEMP_LOCKED {until} (contract M1); checkIp bỏ qua khoá tài khoản", async () => {
    const until = NOW.getTime() + 15 * 60_000;
    const l = fake(async () => ({ kind: "locked", until }));
    const e = await caught(open(l));
    expect([e.code, e.status, e.details]).toEqual([
      "TEMP_LOCKED",
      423,
      { until: new Date(until).toISOString() },
    ]);
    await checkIp(l, "1.2.3.4", NOW);
  });
});

describe("L1c · openLoginSlot · giữ chỗ và Redis lỗi", () => {
  test("L1c · busy (đủ lượt đang verify) ⇒ 429 RATE_LIMITED retry_after_s 1", async () => {
    const e = await caught(open(fake(async () => ({ kind: "busy" }))));
    expect([e.code, e.status, e.details, e.headers]).toEqual([
      "RATE_LIMITED",
      429,
      { retry_after_s: 1 },
      { "Retry-After": "1" },
    ]);
  });

  test("Redis lỗi ⇒ 503 AUTH_UNAVAILABLE + Retry-After (đóng an toàn), cả ở bước ok()", async () => {
    const down = fake(() => Promise.reject(new Error("Stream isn't writeable")));
    const s = await open(fake(async () => ({ kind: "ok" }), { successFails: true }));
    for (const p of [open(down), s.ok()]) {
      const e = await caught(p);
      expect([e.code, e.status]).toEqual(["AUTH_UNAVAILABLE", 503]);
      expect(e.headers?.["Retry-After"]).toMatch(/^\d+$/);
    }
  });
});

describe("L1c · kết thúc lượt", () => {
  test("fail/ok kết thúc lượt ⇒ release không gọi Redis; lượt bỏ dở ⇒ release nhả đúng một lần", async () => {
    const a = fake(async () => ({ kind: "ok" }));
    const s1 = await open(a);
    await s1.fail(null);
    await s1.release();
    const s2 = await open(a);
    await s2.ok();
    await s2.release();
    const s3 = await open(a);
    await s3.release();
    await s3.release();
    expect(a.calls).toEqual(["fail", "success", "release"]);
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

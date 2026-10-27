// tenant-quotas-fix · đặt lại bộ đếm = SET 0 KEEPTTL (không DEL); đọc MGET, vắng/rác ⇒ 0.
import { describe, expect, it } from "bun:test";
import type { Redis } from "../../lib/redis";
import { redisDailyCounter } from "./daily-limits.counter";

describe("tenant-quotas-fix · redisDailyCounter", () => {
  it("reset ⇒ SET key 0 KEEPTTL, không DEL", async () => {
    const calls: unknown[][] = [];
    const fake = {
      set: async (...a: unknown[]) => {
        calls.push(["set", ...a]);
        return "OK";
      },
      del: async (...a: unknown[]) => {
        calls.push(["del", ...a]);
        return 1;
      },
    } as unknown as Redis;
    await redisDailyCounter(fake).reset("q:contracts:t:x:2026-10-27");
    expect(calls).toEqual([["set", "q:contracts:t:x:2026-10-27", "0", "KEEPTTL"]]);
  });

  it("read: null/âm/rác ⇒ 0", async () => {
    const fake = { mget: async () => ["3", null, "-1", "x"] } as unknown as Redis;
    expect(await redisDailyCounter(fake).read(["a", "b", "c", "d"])).toEqual([3, 0, 0, 0]);
  });
});

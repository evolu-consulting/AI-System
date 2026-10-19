// HD-FR-35 · D3-10 · review M2(b): trần thao tác — Redis vắng / `exec` lỗi / phần tử pipeline lỗi ⇒ 503 (đóng an toàn);
// vượt trần ⇒ 429 ACTION_QUOTA {limit, resets_at}; trong trần ⇒ qua. Không Redis thật (giả pipeline tất định).
import { describe, expect, test } from "bun:test";
import type { Redis } from "ioredis";
import { AppError } from "../../../../lib/errors";
import { actionQuota } from "./action-quota";

const NOW = new Date("2026-10-19T03:00:00Z");
const tz = async () => "Asia/Ho_Chi_Minh";
type Exec = () => Promise<[Error | null, unknown][] | null>;
const fakeRedis = (exec: Exec) =>
  ({ pipeline: () => ({ incr: () => ({ expire: () => ({ exec }) }) }) }) as unknown as Redis;

async function codeOf(p: Promise<void>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (e) {
    return e instanceof AppError ? `${e.status}:${e.code}` : "other";
  }
}

describe("actionQuota [D3-10]", () => {
  test("Redis vắng ⇒ 503 UPLOAD_QUOTA_UNAVAILABLE", async () => {
    const q = actionQuota({ limit: 100, timeZoneOf: tz, now: () => NOW });
    expect(await codeOf(q("t1"))).toBe("503:UPLOAD_QUOTA_UNAVAILABLE");
  });
  test("exec ném / trả null / phần tử lỗi ⇒ 503", async () => {
    const cases: Exec[] = [
      () => Promise.reject(new Error("down")),
      () => Promise.resolve(null),
      () =>
        Promise.resolve([
          [new Error("ERR"), null],
          [null, 1],
        ]),
    ];
    for (const exec of cases) {
      const q = actionQuota({ redis: fakeRedis(exec), limit: 100, timeZoneOf: tz, now: () => NOW });
      expect(await codeOf(q("t1"))).toBe("503:UPLOAD_QUOTA_UNAVAILABLE");
    }
  });
  test("lượt 100 qua, lượt 101 ⇒ 429 ACTION_QUOTA kèm limit + resets_at (00:00 ngày kế múi tenant)", async () => {
    let n = 99;
    const exec: Exec = async () => [
      [null, ++n],
      [null, 1],
    ];
    const q = actionQuota({ redis: fakeRedis(exec), limit: 100, timeZoneOf: tz, now: () => NOW });
    expect(await codeOf(q("t1"))).toBeNull();
    try {
      await q("t1");
      throw new Error("phải ném");
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      const a = e as AppError;
      expect({ status: a.status, code: a.code, details: a.details }).toEqual({
        status: 429,
        code: "ACTION_QUOTA",
        details: { limit: 100, resets_at: "2026-10-19T17:00:00.000Z" },
      });
    }
  });
});

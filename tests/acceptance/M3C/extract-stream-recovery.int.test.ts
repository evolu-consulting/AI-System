// M3c · review B #5/#6/#10 · hàng đợi Redis Streams tự phục hồi (Redis thật): (1) `loop()` lỗi lúc khởi động (đọc khoá lỗi) ⇒
// log + đếm + chạy lại có backoff ⇒ job vẫn được xử lý; (2) Redis mất stream + group (FLUSH/restart) ⇒ NOGROUP ⇒ worker tạo lại
// group và đọc tiếp, không chết im lặng; (3) entry giao quá `maxDeliveries` lần ⇒ bỏ (ACK + XDEL, log, đếm), handler KHÔNG chạy.
// Chờ bằng tín hiệu (promise của handler / hook), không sleep/poll.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createRedis } from "../../../apps/hub-api/src/lib/redis";
import { createExtractStream } from "../../../apps/hub-api/src/modules/packs/contracts/adapters/extract-stream.redis";
import type { ExtractJob } from "../../../apps/hub-api/src/modules/packs/contracts/application/approval.usecase";
import { REDIS_TEST_URL } from "../H1/_fixtures";

const redis = createRedis(REDIS_TEST_URL);
const ac = new AbortController();
const ns = `contracts:extract:m3c-${crypto.randomUUID().slice(0, 8)}`;
const uuid = () => crypto.randomUUID();
const job = (): ExtractJob => ({
  tenantId: uuid(),
  userId: uuid(),
  contractId: uuid(),
  approvalId: uuid(),
});

beforeAll(async () => {
  await redis.connect();
});
afterAll(async () => {
  ac.abort();
  const keys = await redis.keys(`${ns}*`);
  if (keys.length > 0) await redis.del(...keys);
  redis.disconnect();
});

/** Tín hiệu một lần: `wait` resolve khi `fire` được gọi. */
function signal<T = void>() {
  let fire: (v: T) => void = () => undefined;
  const wait = new Promise<T>((res) => {
    fire = res;
  });
  return { fire, wait };
}
function logSpy() {
  const msgs: string[] = [];
  return { msgs, warn: (m: string) => void msgs.push(m) };
}

describe("M3c · worker hàng đợi tự phục hồi", () => {
  it("#5 · loop() lỗi lúc khởi động ⇒ log contract-extract-worker-failed, chạy lại (backoff) ⇒ job vẫn xử lý", async () => {
    const key = `${ns}:start`;
    let calls = 0;
    const failed = signal<number>();
    const got = signal<ExtractJob>();
    const log = logSpy();
    const s = createExtractStream({
      redis,
      key: async () => {
        calls += 1;
        if (calls === 1) throw new Error("db down");
        return key;
      },
      consumer: "w-start",
      handle: async (j) => got.fire(j),
      blockMs: 100,
      retryMs: 5,
      log,
      signal: ac.signal,
      onWorkerError: (n) => failed.fire(n),
    });
    s.start();
    expect(await failed.wait).toBe(1);
    const j = job();
    await s.enqueue(j);
    expect(await got.wait).toEqual(j);
    expect(s.stats().restarts).toBe(1);
    expect(log.msgs).toContain("contract-extract-worker-failed");
  });

  it("#6 · Redis mất stream + group ⇒ NOGROUP ⇒ tạo lại group, job sau vẫn được xử lý", async () => {
    const key = `${ns}:nogroup`;
    const seen: ExtractJob[] = [];
    const waits = [signal(), signal()];
    const log = logSpy();
    const s = createExtractStream({
      redis,
      key: async () => key,
      consumer: "w-nogroup",
      handle: async (j) => {
        seen.push(j);
        waits[seen.length - 1]?.fire();
      },
      blockMs: 100,
      retryMs: 5,
      log,
      signal: ac.signal,
    });
    s.start();
    const [j1, j2] = [job(), job()];
    await s.enqueue(j1);
    await waits[0]?.wait;
    await redis.del(key); // mất cả stream lẫn group (như FLUSHDB / restart không AOF)
    await s.enqueue(j2);
    await waits[1]?.wait;
    expect(seen).toEqual([j1, j2]);
    expect(s.stats().groupRecreated).toBeGreaterThanOrEqual(1);
    expect(log.msgs).toContain("contract-extract-group-recreated");
  });

  it("#10 · entry giao quá maxDeliveries ⇒ bỏ (ACK + XDEL + log), handler không chạy", async () => {
    const key = `${ns}:poison`;
    const producer = createExtractStream({
      redis,
      key: async () => key,
      consumer: "dead",
      handle: async () => undefined,
      log: logSpy(),
    });
    await producer.enqueue(job());
    await producer.reclaimOnce(); // bảo đảm group tồn tại
    const got = (await redis.xreadgroup(
      "GROUP",
      "contracts-extract",
      "dead",
      "COUNT",
      1,
      "STREAMS",
      key,
      ">",
    )) as [string, [string, string[]][]][];
    const id = got[0]?.[1][0]?.[0] as string;
    // Entry đã làm sập nhiều instance: đặt bộ đếm giao = 9.
    await redis.call("XCLAIM", key, "contracts-extract", "dead", "0", id, "RETRYCOUNT", "9");
    let handled = 0;
    const acked = signal<string>();
    const log = logSpy();
    const rescuer = createExtractStream({
      redis,
      key: async () => key,
      consumer: "w-poison",
      handle: async () => {
        handled += 1;
      },
      claimIdleMs: 0,
      maxDeliveries: 5,
      log,
      onAcked: (e) => acked.fire(e),
    });
    expect(await rescuer.reclaimOnce()).toBe(1);
    expect(await acked.wait).toBe(id);
    expect(handled).toBe(0);
    expect(rescuer.stats().poison).toBe(1);
    expect(log.msgs).toContain("contract-extract-poison");
    expect(await redis.xlen(key)).toBe(0);
  });
});

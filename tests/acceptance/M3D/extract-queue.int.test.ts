// M3-decouple · #218 · hàng đợi BỀN lượt AI đọc HĐ trên Redis Streams (Redis thật): (1) enqueue ⇒ worker xử lý đúng job rồi
// XACK + XDEL (stream rỗng, PEL rỗng); (2) consumer chết giữa chừng (đã nhận, chưa ACK) ⇒ instance khác nhận lại bằng XAUTOCLAIM
// và xử lý — job không mất; (3) entry hỏng ⇒ bỏ qua + ACK (không kẹt); (4) khoá stream tách theo DB ⇒ worker không lấy job của
// stream khác. Chờ bằng tín hiệu (promise của handler), không sleep/poll.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createRedis } from "../../../apps/hub-api/src/lib/redis";
import {
  createExtractStream,
  parseJob,
} from "../../../apps/hub-api/src/modules/packs/contracts/adapters/extract-stream.redis";
import type { ExtractJob } from "../../../apps/hub-api/src/modules/packs/contracts/application/approval.usecase";
import { REDIS_TEST_URL } from "../H1/_fixtures";

const redis = createRedis(REDIS_TEST_URL);
const ac = new AbortController();
const ns = `contracts:extract:m3d-${crypto.randomUUID().slice(0, 8)}`;
const uuid = () => crypto.randomUUID();
const job = (): ExtractJob => ({
  tenantId: uuid(),
  userId: uuid(),
  contractId: uuid(),
  approvalId: uuid(),
});
const log = { warn: () => undefined };

beforeAll(async () => {
  await redis.connect();
});
afterAll(async () => {
  ac.abort();
  const keys = await redis.keys(`${ns}*`);
  if (keys.length > 0) await redis.del(...keys);
  redis.disconnect();
});

/** Handler ghi job + promise resolve khi đủ `n` job. */
function collector(n: number) {
  const seen: ExtractJob[] = [];
  let done: () => void = () => undefined;
  const all = new Promise<void>((res) => {
    done = res;
  });
  return {
    seen,
    all,
    handle: async (j: ExtractJob) => {
      seen.push(j);
      if (seen.length >= n) done();
    },
  };
}

describe("M3 · hàng đợi Redis Streams", () => {
  it("enqueue ⇒ worker xử lý đúng job, rồi ACK + XDEL (không còn entry / PEL)", async () => {
    const key = `${ns}:a`;
    const col = collector(2);
    const acked = collector(2);
    const s = createExtractStream({
      redis,
      key: async () => key,
      consumer: "w1",
      handle: col.handle,
      onAcked: () => void acked.handle(job()),
      blockMs: 200,
      log,
      signal: ac.signal,
    });
    s.start();
    const [j1, j2] = [job(), job()];
    await s.enqueue(j1);
    await s.enqueue(j2);
    await col.all;
    expect(col.seen).toEqual([j1, j2]);
    await acked.all; // tín hiệu: cả hai entry đã ACK + XDEL
    const pending = async () =>
      ((await redis.xpending(key, "contracts-extract")) as [number])[0] ?? 0;
    expect({ pending: await pending(), len: await redis.xlen(key) }).toEqual({
      pending: 0,
      len: 0,
    });
  });

  it("consumer chết (nhận, chưa ACK) ⇒ worker khác XAUTOCLAIM ⇒ job được xử lý, không mất", async () => {
    const key = `${ns}:b`;
    const j = job();
    const producer = createExtractStream({
      redis,
      key: async () => key,
      consumer: "dead",
      handle: async () => undefined,
      log,
    });
    await producer.enqueue(j); // tạo group + entry
    await producer.reclaimOnce(); // bảo đảm group tồn tại (không có entry treo)
    // Consumer "dead" nhận entry rồi không ACK (giả lập tiến trình chết giữa lượt AI).
    const got = await redis.xreadgroup(
      "GROUP",
      "contracts-extract",
      "dead",
      "COUNT",
      1,
      "STREAMS",
      key,
      ">",
    );
    expect((got as unknown[] | null)?.length).toBe(1);
    const col = collector(1);
    const rescuer = createExtractStream({
      redis,
      key: async () => key,
      consumer: "w2",
      handle: col.handle,
      claimIdleMs: 0,
      log,
    });
    expect(await rescuer.reclaimOnce()).toBe(1);
    await col.all;
    expect(col.seen).toEqual([j]);
  });

  it("entry hỏng ⇒ không gọi handler; parseJob chỉ nhận uuid đúng dạng", () => {
    expect(parseJob("not json")).toBeNull();
    expect(parseJob(JSON.stringify({ t: "x", u: uuid(), c: uuid(), a: null }))).toBeNull();
    const j = job();
    expect(
      parseJob(JSON.stringify({ t: j.tenantId, u: j.userId, c: j.contractId, a: null })),
    ).toEqual({
      ...j,
      approvalId: null,
    });
  });

  it("khoá stream theo DB: job ở stream khác không bị worker này lấy", async () => {
    const col = collector(1);
    const mine = createExtractStream({
      redis,
      key: async () => `${ns}:c1`,
      consumer: "w3",
      handle: col.handle,
      blockMs: 200,
      log,
      signal: ac.signal,
    });
    const other = createExtractStream({
      redis,
      key: async () => `${ns}:c2`,
      consumer: "w4",
      handle: async () => undefined,
      log,
    });
    mine.start();
    const theirs = job();
    await other.enqueue(theirs);
    const ours = job();
    await mine.enqueue(ours);
    await col.all;
    expect(col.seen).toEqual([ours]);
    expect(await redis.xlen(`${ns}:c2`)).toBe(1);
  });
});

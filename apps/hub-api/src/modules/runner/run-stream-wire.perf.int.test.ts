// CR-114 hub-binary-wire · Luật 4c · độ trễ delta Runtime→Hub trên `run:<id>` (đường dây JSON hiện tại): XADD 1.000 `job.delta`
// (200 ký tự, đúng khuôn Runtime) → `RunStreamReader` → `push`. Đo p50/p95/max từ lúc gửi XADD tới lúc `push` (parse + zod gồm trong đó).
// Ngưỡng p95 ≤ 150 ms = ngân sách delta đầu (H2b P11). Hai kiểu: tuần tự (mỗi XADD chờ xong, như DeltaPump) và burst (một pipeline).
// Chạy riêng: `bun run test:perf` hoặc evotest `-Step perf -Filter apps/hub-api/src/modules/runner/run-stream-wire.perf.int.test.ts`.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { RUN_STREAM_FIELD, type RunEvent, runStreamKey } from "@ai/contracts/hub";
import { latencyStats } from "@ai/test-kit/perf";
import { logger } from "../../lib/logger";
import { createRedis, type Redis } from "../../lib/redis";
import { RunStreamReader } from "./run-stream-reader";

const N = 1000;
const THRESHOLD_MS = 150;
const JOB = "7d0b6d5e-3c1c-4f55-9d0e-1f3a8f6d2a11";
const VI =
  "Điều 12. Nghĩa vụ của bên B: bên B có trách nhiệm thanh toán đầy đủ và đúng hạn theo phụ lục hợp đồng; trường hợp chậm thanh toán quá 15 ngày, bên A có quyền tạm ngừng cung cấp dịch vụ. ";
const TEXT = VI.slice(0, 200);
const REDIS_URL = process.env.HUB_TEST_REDIS_URL ?? "redis://localhost:6379/15";

const body = (seq: number): string =>
  JSON.stringify({
    v: 1,
    seq,
    at: "2026-11-03T06:41:12.345678+00:00",
    type: "job.delta",
    job_id: JOB,
    kind: "answer",
    text: TEXT,
  });

let redis: Redis;
let writer: Redis;
let reader: RunStreamReader;
const ac = new AbortController();
const keys: string[] = [];

beforeAll(async () => {
  redis = createRedis(REDIS_URL);
  writer = createRedis(REDIS_URL);
  await Promise.all([redis.connect(), writer.connect()]);
  reader = new RunStreamReader(redis, logger, ac.signal);
});
afterAll(async () => {
  ac.abort();
  if (keys.length) await writer.del(...keys);
  writer.disconnect();
  redis.disconnect();
});

/** XADD N delta (`send` quyết định kiểu) và trả độ trễ (ms) mỗi sự kiện tới `push`. */
async function run(send: (key: string, t0: number[]) => Promise<void>): Promise<number[]> {
  const runId = crypto.randomUUID();
  const key = runStreamKey(runId);
  keys.push(key);
  const t0: number[] = [];
  const lat: number[] = [];
  let done!: () => void;
  const all = new Promise<void>((r) => {
    done = r;
  });
  const cancel = await reader.subscribe(runId, (e: RunEvent) => {
    lat.push(performance.now() - (t0[e.seq] as number));
    if (lat.length === N) done();
  });
  await send(key, t0);
  await all;
  cancel();
  return lat;
}

describe("run:<id> · độ trễ delta (JSON)", () => {
  it(`tuần tự ${N} XADD: p95 ≤ ${THRESHOLD_MS} ms`, async () => {
    const lat = await run(async (key, t0) => {
      for (let seq = 1; seq <= N; seq++) {
        t0[seq] = performance.now();
        await writer.xadd(key, "*", RUN_STREAM_FIELD, body(seq));
      }
    });
    const s = latencyStats(lat);
    console.log(
      `[wire-latency] sequential n=${s.n} p50=${s.p50.toFixed(2)}ms p95=${s.p95.toFixed(2)}ms max=${s.max.toFixed(2)}ms`,
    );
    expect(s.n).toBe(N);
    expect(s.p95).toBeLessThanOrEqual(THRESHOLD_MS);
  });

  it(`burst ${N} XADD trong một pipeline: tất cả tới nơi, p95 ≤ ${THRESHOLD_MS} ms`, async () => {
    const lat = await run(async (key, t0) => {
      const p = writer.pipeline();
      for (let seq = 1; seq <= N; seq++) p.xadd(key, "*", RUN_STREAM_FIELD, body(seq));
      const start = performance.now();
      for (let seq = 1; seq <= N; seq++) t0[seq] = start;
      await p.exec();
    });
    const s = latencyStats(lat);
    console.log(
      `[wire-latency] burst-pipeline n=${s.n} p50=${s.p50.toFixed(2)}ms p95=${s.p95.toFixed(2)}ms max=${s.max.toFixed(2)}ms`,
    );
    expect(s.n).toBe(N);
    expect(s.p95).toBeLessThanOrEqual(THRESHOLD_MS);
  });
});

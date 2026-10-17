// Spike ADR-0017 · bài tải engine (docs/platform/spike-engine.md bài 6, mở rộng). KHÔNG thuộc acceptance/CI.
//   LOAD_N=10000 bun --env-file=.env.local --config=bunfig.int.toml test --timeout 3600000 spikes/engine/load.spike.test.ts
// Đo trên engine hiện có (phương án a): dựng N run chờ duyệt (mỗi run 1 task review, Group 2 người), rồi đo
//   1) vòng nhắc `remindOnce` (lô 100) tới khi hết — p50/p95 mỗi lượt, tổng thời gian;
//   2) hai Hub nhắc song song trên N task mới — không nhắc trùng (đúng N×2 notice);
//   3) `sweepOnce` khi có N run đang chạy; 4) hết hạn: dời đồng hồ 8 ngày, `sweepOnce` tới khi hết — tổng `expired`.
// Ghi JSON tóm tắt ra console và `.data/spike-load-<N>.json` (`SPIKE_OUT` đổi thư mục).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Json } from "../../tests/acceptance/P-a/_support/pa";
import { type CtxPf1, handles, secondHub, startPf1 } from "../../tests/acceptance/P-a/pf1/_local";
import { reviewRun } from "../../tests/acceptance/P-a/pf3/_local";

const N = Number(process.env.LOAD_N ?? 1000);
const OUT = process.env.SPIKE_OUT ?? ".data";
const H = 3_600_000;
let clock = Date.now();
const now = () => new Date(clock);
let c: CtxPf1;
const report: Record<string, unknown> = { N, startedAt: new Date().toISOString() };

beforeAll(async () => {
  c = await startPf1({ now });
}, 600_000);
afterAll(async () => {
  report.finishedAt = new Date().toISOString();
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, `spike-load-${N}.json`), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ spikeLoad: report }));
  await c?.stop();
});

const pct = (xs: number[], p: number) =>
  [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * p))] ?? 0;
const round1 = (x: number) => Math.round(x * 10) / 10;

async function seed(n: number): Promise<number> {
  const t0 = performance.now();
  for (let i = 0; i < n; i += 50) {
    await Promise.all(Array.from({ length: Math.min(50, n - i) }, () => reviewRun(c)));
  }
  await c.sql`update hub.review_tasks set remind_at = ${new Date(clock - H)}
    where status = 'open' and reminded_at is null`;
  return round1(performance.now() - t0);
}

async function drain(fn: () => Promise<number>): Promise<{ total: number; rounds: number[] }> {
  const rounds: number[] = [];
  let total = 0;
  for (;;) {
    const a = performance.now();
    const k = await fn();
    rounds.push(performance.now() - a);
    total += k;
    if (k === 0 || rounds.length > 10_000) return { total, rounds };
  }
}

const countReminders = async () =>
  (
    await c.sql<Json[]>`select count(*)::int as n from hub.process_notices where kind = 'reminder'`
  )[0]?.n ?? 0;

describe(`Spike tải engine · N=${N}`, () => {
  it("1 · vòng nhắc: nhắc đủ N task, mỗi lượt nhanh", async () => {
    report.seedMs = await seed(N);
    const before = await countReminders();
    const t0 = performance.now();
    const { total, rounds } = await drain(() => handles(c).remindOnce());
    report.remind = {
      total,
      rounds: rounds.length,
      totalMs: round1(performance.now() - t0),
      p50Ms: round1(pct(rounds, 0.5)),
      p95Ms: round1(pct(rounds, 0.95)),
      notices: (await countReminders()) - before,
    };
    expect(total).toBeGreaterThanOrEqual(N);
    expect(pct(rounds, 0.95)).toBeLessThan(5_000);
  }, 3_600_000);

  it("2 · hai Hub nhắc song song: không nhắc trùng", async () => {
    await seed(N);
    const before = await countReminders();
    const hub2 = await secondHub(c, { now });
    try {
      const h1 = handles(c);
      const h2 = hub2.handles() as Json;
      const t0 = performance.now();
      const [a, b] = await Promise.all([
        drain(() => h1.remindOnce()),
        drain(() => h2.remindOnce()),
      ]);
      const notices = (await countReminders()) - before;
      report.remindParallel = {
        hub1: a.total,
        hub2: b.total,
        totalMs: round1(performance.now() - t0),
        notices,
      };
      expect(a.total + b.total).toBe(N);
      expect(notices).toBe(N * 2);
    } finally {
      await hub2.stop();
    }
  }, 3_600_000);

  it("3 · sweepOnce khi có nhiều run đang chạy; 4 · hết hạn sau 8 ngày", async () => {
    const [active] = await c.sql<Json[]>`select count(*)::int as n from hub.process_runs
      where status in ('running','waiting_review','waiting_answer','needs_decision')`;
    const s0 = performance.now();
    await handles(c).sweepOnce();
    const sweepMs = round1(performance.now() - s0);
    clock += 8 * 24 * H;
    const t0 = performance.now();
    const rounds: number[] = [];
    let expired = 0;
    for (;;) {
      const a = performance.now();
      const r = (await handles(c).sweepOnce()) as { expired: number };
      rounds.push(performance.now() - a);
      expired += r.expired;
      if (r.expired === 0 || rounds.length > 10_000) break;
    }
    report.sweep = {
      activeRuns: active?.n,
      sweepMs,
      expired,
      expireRounds: rounds.length,
      expireTotalMs: round1(performance.now() - t0),
      expireP95Ms: round1(pct(rounds, 0.95)),
    };
    expect(expired).toBeGreaterThanOrEqual(Number(active?.n ?? 0));
  }, 3_600_000);
});

// AC-H41 · AC-H46 · HUB-FR-143/144 · test-plan-int §9 PD-P01, PD-P02 (không thuộc Lệnh xong, `bun run test:perf`): 1.000 hẹn
// `retry` tới hạn (500 acme + 500 beta, fixture SQL) ⇒ quét lặp tới hết — mỗi lượt ≤ TIMER_SWEEP_BATCH (100), mọi hẹn bắn
// đúng 1 lần, 1 job/stage. Báo ms/lượt p50/p95 (console), không ngưỡng khoá ngoài "đúng một lần".
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { HubPa } from "../../P-a/_support/pa";
import {
  type CtxPd,
  DEFS,
  insertDefPf1,
  type Json,
  needPdSchema,
  P1,
  PA,
  SEC,
  secondHub,
  startPd,
  sweepN,
  T,
  waitFor,
} from "../_support/pd";
import { fireStats, insertDueRetries, quantile } from "../d1/_bulk";
import { settle, sweepOn } from "../d1/_wait";

let c: CtxPd;
let h2: HubPa | undefined;
beforeAll(async () => {
  c = await startPd();
}, 60_000);
afterAll(async () => {
  await h2?.stop();
  await c?.stop();
});

const N = 500; // mỗi tenant
const BATCH = 100; // TIMER_SWEEP_BATCH (plan-contract §1)
const BETA_SINGLE = { ...DEFS.single, id: "a5d20000-0000-4000-8000-0000ffff0001" };
let betaReady = false;

/** Def agent đơn cho beta + entitlement/grant hd-read cho D (để launcher tạo job beta như acme). */
async function prepareBeta(): Promise<void> {
  if (betaReady) return;
  await insertDefPf1(c.sql, BETA_SINGLE, { tenantId: T.beta });
  await c.sql`insert into hub.agent_entitlements (agent_id, tenant_id) values (${P1.agRead}, ${T.beta})`;
  await c.sql`insert into hub.agent_grants (agent_id, tenant_id, subject_type, subject_id)
    values (${P1.agRead}, ${T.beta}, 'user', ${PA.D.id})`;
  await c.sql`update hub.config_meta set hub_config_version = hub_config_version + 1 where id = 1`;
  betaReady = true;
}

/** 500 acme + 500 beta hẹn retry tới hạn; trả id stage. */
async function seedDue(): Promise<string[]> {
  await settle(c.sql);
  await prepareBeta();
  const now = c.clk.now();
  const dueAt = new Date(now.getTime() - 60 * SEC);
  const a = await insertDueRetries(c.sql, { def: DEFS.single, who: PA.A, n: N, dueAt, now });
  const b = await insertDueRetries(c.sql, { def: BETA_SINGLE, who: PA.D, n: N, dueAt, now });
  return [...a.stageRunIds, ...b.stageRunIds];
}

/** Một lượt quét đo ms; `sweeps` = các hàm quét chạy song song. */
async function timed(sweeps: (() => Promise<Json>)[]): Promise<{ ms: number; rs: Json[] }> {
  const t0 = performance.now();
  const rs = await Promise.all(sweeps.map((f) => f()));
  return { ms: performance.now() - t0, rs };
}

async function drain(sweeps: (() => Promise<Json>)[], ids: string[], tag: string) {
  const ms: number[] = [];
  const counts: number[] = [];
  for (let i = 0; i < 40; i++) {
    const r = await timed(sweeps);
    ms.push(r.ms);
    counts.push(...r.rs.map((x) => Number(x?.timers ?? -1)));
    if ((await fireStats(c.sql, ids)).open === 0) break;
  }
  console.log(
    `[perf] ${tag}: lượt=${ms.length} p50=${quantile(ms, 0.5).toFixed(1)}ms p95=${quantile(ms, 0.95).toFixed(1)}ms timers/lượt=${counts.join(",")}`,
  );
  return { ms, counts };
}

describe("PD-P01, PD-P02 · tải hẹn giờ [AC-H41][test-plan-int §9]", () => {
  it("AC-H41 · PD-P01 · 1.000 hẹn retry tới hạn (500 acme + 500 beta) ⇒ quét lặp: ≤ 100/lượt, 10 lượt, 1.000 fired, 1.000 job, 0 trùng", async () => {
    needPdSchema(c.pd);
    const ids = await seedDue();
    const { ms, counts } = await drain([() => sweepN(c, 1)], ids, "PD-P01 1 hub");
    for (const n of counts) expect(n).toBeLessThanOrEqual(BATCH);
    expect(ms.length).toBe(10);
    const st = await waitFor(
      () => fireStats(c.sql, ids),
      (s) => s.jobs >= 2 * N,
      120_000,
    );
    expect(st).toEqual({ fired: 2 * N, open: 0, jobs: 2 * N, dupJobs: 0, noJob: 0 });
  }, 300_000);

  it("AC-H41 · PD-P02 · như P01 với 2 hub quét song song ⇒ 1.000 bắn đúng 1 lần, 1.000 job, 0 trùng", async () => {
    needPdSchema(c.pd);
    const ids = await seedDue();
    h2 = await secondHub(c, { now: c.clk.now });
    const other = h2;
    const { counts } = await drain([() => sweepN(c, 1), () => sweepOn(other)], ids, "PD-P02 2 hub");
    for (const n of counts) expect(n).toBeLessThanOrEqual(BATCH);
    expect(counts.reduce((a, n) => a + n, 0)).toBe(2 * N);
    const st = await waitFor(
      () => fireStats(c.sql, ids),
      (s) => s.jobs >= 2 * N,
      120_000,
    );
    expect(st).toEqual({ fired: 2 * N, open: 0, jobs: 2 * N, dupJobs: 0, noJob: 0 });
  }, 300_000);
});

// CR-116 · kịch bản `timer.fire` (PD-P01): hẹn `retry` tới hạn bắn theo lô 100 qua `sweepOnce` (probe mã thật: `timer.fire`,
// cộng `sweep.once` ở đây). small = 5 vòng × (50 acme + 50 beta tới hạn → 1 lượt quét); large = 500 + 500 quét lặp tới hết.
// Fixture dùng lại của PD-P01 (`tests/acceptance/P-d/perf/timers.perf.int.test.ts`).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { probe } from "@ai/db/probe";
import {
  type CtxPd,
  DEFS,
  insertDefPf1,
  P1,
  PA,
  SEC,
  startPd,
  sweepN,
  T,
} from "../acceptance/P-d/_support/pd";
import { fireStats, insertDueRetries } from "../acceptance/P-d/d1/_bulk";
import { settle } from "../acceptance/P-d/d1/_wait";
import { probing, runScenario } from "./_scn";

let c: CtxPd;
beforeAll(async () => {
  if (probing) c = await startPd();
}, 60_000);
afterAll(async () => {
  await c?.stop();
});

const BETA_SINGLE = { ...DEFS.single, id: "a5d20000-0000-4000-8000-0000ffff0001" };
let betaReady = false;
async function prepareBeta(): Promise<void> {
  if (betaReady) return;
  await insertDefPf1(c.sql, BETA_SINGLE, { tenantId: T.beta });
  await c.sql`insert into hub.agent_entitlements (agent_id, tenant_id) values (${P1.agRead}, ${T.beta})`;
  await c.sql`insert into hub.agent_grants (agent_id, tenant_id, subject_type, subject_id)
    values (${P1.agRead}, ${T.beta}, 'user', ${PA.D.id})`;
  await c.sql`update hub.config_meta set hub_config_version = hub_config_version + 1 where id = 1`;
  betaReady = true;
}
async function seedDue(n: number): Promise<string[]> {
  await settle(c.sql);
  await prepareBeta();
  const now = c.clk.now();
  const dueAt = new Date(now.getTime() - 60 * SEC);
  const a = await insertDueRetries(c.sql, { def: DEFS.single, who: PA.A, n, dueAt, now });
  const b = await insertDueRetries(c.sql, { def: BETA_SINGLE, who: PA.D, n, dueAt, now });
  return [...a.stageRunIds, ...b.stageRunIds];
}

/** Chèn 2n hẹn tới hạn rồi quét lặp tới hết (mỗi lượt ≤ 100). */
async function drainRound(n: number): Promise<void> {
  const ids = await seedDue(n);
  for (let s = 0; s < 40; s++) {
    await probe("sweep.once", () => sweepN(c, 1));
    if ((await fireStats(c.sql, ids)).open === 0) break;
  }
  expect((await fireStats(c.sql, ids)).open).toBe(0);
}

describe.skipIf(!probing)("probe · timer.fire (PD-P01)", () => {
  it("timer.fire · hẹn tới hạn bắn theo lô", async () => {
    await runScenario("timer.fire", c.sql, async (_r, size) => {
      for (let i = 0; i < (size === "large" ? 1 : 5); i++)
        await drainRound(size === "large" ? 500 : 50);
    });
  }, 900_000);
});

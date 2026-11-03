// CR-116 · kịch bản `remind` (PD-P13) và `expire` (PD-P14): lô 100 task nhắc / 100 run hết hạn qua `remindOnce` / `sweepOnce`
// (probe mã thật: `remind.once`, `expire.runs`; cộng `sweep.once` ở đây). small = 5 vòng/lượt; large = 20 vòng (như perf test gốc).
// Fixture dùng lại của `tests/acceptance/P-d/perf/background.perf.int.test.ts`.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { probe } from "@ai/db/probe";
import { type CtxPd, remind, startPd, sweepN } from "../acceptance/P-d/_support/pd";
import { dueReviewTasks, expireStats, expiringRuns, remindStats } from "../acceptance/P-d/d1/_load";
import { probing, runScenario, scnOpts } from "./_scn";

let c: CtxPd;
beforeAll(async () => {
  if (probing)
    c = await startPd({ processRunsPerTenant: scnOpts().size === "large" ? 50_000 : 5_000 });
}, 120_000);
afterAll(async () => {
  await c?.stop();
});

describe.skipIf(!probing)("probe · remind / expire (PD-P13, PD-P14)", () => {
  it("remind · lô 100 task tới hạn", async () => {
    await remind(c); // khởi động pool, ngoài khoảng đo
    await runScenario("remind", c.sql, async (_r, size) => {
      for (let i = 0; i < (size === "large" ? 20 : 5); i++) {
        const ids = await dueReviewTasks(c, 100);
        await probe("remind.batch100", () => remind(c));
        expect((await remindStats(c, ids)).reminded).toBe(100);
      }
    });
  }, 900_000);

  it("expire · lô 100 run hết hạn", async () => {
    await sweepN(c); // khởi động + dọn tồn
    await runScenario("expire", c.sql, async (_r, size) => {
      for (let i = 0; i < (size === "large" ? 20 : 5); i++) {
        const { runIds } = await expiringRuns(c, 100);
        await probe("sweep.once", () => sweepN(c));
        expect((await expireStats(c, runIds)).expired).toBe(100);
      }
    });
  }, 900_000);
});

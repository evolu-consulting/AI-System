// AC-H42 · HUB-FR-145 · PD-R18 · PD-P03 (test-plan-int §9; plan-addendum A9): 1.000 task review `remind_every_h:4` tới hạn ⇒
// `remindOnce` lặp tới 0 ⇒ 1.000 `remind_count`=1, notice đúng số assignee (G1: B, T ⇒ 2.000), 0 trùng; báo ms/lượt.
// Không ngưỡng khoá (`bun run test:perf`). Cột 0036 ⇒ `needPdSchema` trước khi chèn.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { type CtxPd, needPdSchema, remind, startPd } from "../_support/pd";
import { dueReviewTasks, remindStats } from "../d1/_load";

let c: CtxPd;
beforeAll(async () => {
  c = await startPd({ processRunsPerTenant: 5_000 });
}, 60_000);
afterAll(async () => {
  await c?.stop();
});

const pct = (xs: number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))] ?? 0;
};

describe("PD-P03 · tải vòng nhắc [AC-H42, A9]", () => {
  it("AC-H42 · PD-P03 · 1.000 task remind_every_h 4 tới hạn ⇒ remind lặp tới 0: 1.000 remind_count=1, 2.000 notice, 0 trùng; báo ms/lượt", async () => {
    needPdSchema(c.pd);
    const ids = await dueReviewTasks(c, 1_000, { remindEveryH: 4 });
    const perCall: { n: number; ms: number }[] = [];
    for (let i = 0; i < 30; i++) {
      const t0 = performance.now();
      const n = await remind(c);
      perCall.push({ n, ms: Math.round(performance.now() - t0) });
      if (n === 0) break;
    }
    const busy = perCall.filter((p) => p.n > 0).map((p) => p.ms);
    console.log(
      `PD-P03 lượt=${perCall.length} n/lượt=${perCall.map((p) => p.n).join(",")} ms/lượt=${perCall
        .map((p) => p.ms)
        .join(",")} p50=${pct(busy, 0.5)} p95=${pct(busy, 0.95)}`,
    );
    expect(perCall.at(-1)?.n).toBe(0);
    const [rc] = await c.sql<{ n: number }[]>`select count(*)::int as n from hub.review_tasks
      where id = any(${c.sql.array(ids, 2950)}) and remind_count = 1`;
    expect(rc?.n).toBe(1_000);
    const st = await remindStats(c, ids);
    expect({ notices: st.notices, dupPairs: st.dupPairs }).toEqual({ notices: 2_000, dupPairs: 0 });
  }, 600_000);
});

// HUB-FR-112 · PD-R18 · CR-093 · plan-addendum A9, A10 · TECH-DEBT #190 · PD-P10, PD-P11 (test-plan-addendum §2 "Hiệu năng
// vòng nền + nhắc nhiều Hub"): vòng nhắc xả hết task tới hạn trong MỘT lượt (không dừng ở lô 100) và hai Hub nhắc song
// song không trùng ("nhắc 1 lần"). Cột CŨ (0019) ⇒ `needSchema(c.ready)`, không cần 0036. Tái hiện lỗi (Luật 4b).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { needSchema } from "../../P-a/_support/schema";
import { type CtxPd, type Json, remind, secondHub, startPd, waitFor } from "../_support/pd";
import { dueReviewTasks, remindStats } from "./_load";

let c: CtxPd;
beforeAll(async () => {
  c = await startPd({ processRunsPerTenant: 2_000 });
}, 60_000);
afterAll(async () => {
  await c?.stop();
});

describe("PD-P11 · một lượt nhắc xả hết tồn [HUB-FR-112, A9]", () => {
  it("HUB-FR-112 · PD-P11 · 250 task review tới hạn (G1: B, T) ⇒ MỘT remind ⇒ 250 reminded_at, 500 notice reminder; lượt sau 0", async () => {
    needSchema(c.ready);
    const ids = await dueReviewTasks(c, 250);
    await remind(c);
    expect(await remindStats(c, ids)).toEqual({ reminded: 250, notices: 500, dupPairs: 0 });
    expect(await remind(c)).toBe(0);
    expect((await remindStats(c, ids)).notices).toBe(500);
  }, 60_000);
});

describe("PD-P10 · hai Hub nhắc song song không trùng [HUB-FR-112, TECH-DEBT #190, A10]", () => {
  it("HUB-FR-112 · PD-P10 · 250 task tới hạn; 2 Hub cùng DB remindOnce song song tới khi cả hai trả 0 ⇒ đúng 250 task nhắc, 500 notice (250 × 2 người nhận), 0 cặp trùng", async () => {
    needSchema(c.ready);
    const ids = await dueReviewTasks(c, 250);
    const h2 = await secondHub(c, { now: c.clk.now });
    try {
      const hs2 = await waitFor(
        async () => h2.handles(),
        (h) => typeof h?.remindOnce === "function",
        5_000,
      );
      expect({ remindOnce2: typeof hs2?.remindOnce }).toEqual({ remindOnce2: "function" });
      const one = c.hub.handles() as Json;
      for (let i = 0; i < 20; i++) {
        const [a, b] = (await Promise.all([
          one.remindOnce(),
          (hs2 as Json).remindOnce(),
        ])) as number[];
        if (a === 0 && b === 0) break;
      }
      expect(await remindStats(c, ids)).toEqual({ reminded: 250, notices: 500, dupPairs: 0 });
    } finally {
      await h2.stop();
    }
  }, 60_000);
});

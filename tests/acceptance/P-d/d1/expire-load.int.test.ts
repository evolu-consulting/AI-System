// HUB-FR-115 · HUB-FR-113 · CR-093 · plan-addendum A10 · PD-P12 (test-plan-addendum §2 "Hiệu năng vòng nền"): 250 run chờ
// duyệt trong phòng, `expires_at` quá khứ (đồng hồ giả) ⇒ `sweepOnce` lặp tới hết ⇒ 250 `expired`, task `closed/expired`,
// mỗi run đúng một `run_end`; KHÔNG đăng thread trong vòng (`posted_at` còn NULL — `thread-poster` đăng sau). Cột cũ (0019).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { needSchema } from "../../P-a/_support/schema";
import { type CtxPd, type Json, startPd, sweepN } from "../_support/pd";
import { expireStats, expiringRuns } from "./_load";

let c: CtxPd;
beforeAll(async () => {
  c = await startPd({ processRunsPerTenant: 2_000 });
}, 60_000);
afterAll(async () => {
  await c?.stop();
});

/** `sweepOnce` tới khi lượt không còn run hết hạn (trần `max` lượt). Trả số lượt có hết hạn. */
async function sweepDrain(max: number): Promise<number> {
  let busy = 0;
  for (let i = 0; i < max; i++) {
    const r = (await sweepN(c)) as Json;
    if (!(Number(r?.expired) > 0)) break;
    busy++;
  }
  return busy;
}

describe("PD-P12 · hết hạn 250 run theo tập [HUB-FR-115, A10]", () => {
  it("HUB-FR-115 · PD-P12 · 250 run waiting_review hết hạn ⇒ sweepOnce tới hết ⇒ 250 expired, 250 task closed/expired, mỗi run đúng 1 run_end, 0 run_end đã đăng trong vòng", async () => {
    needSchema(c.ready);
    const { runIds } = await expiringRuns(c, 250);
    await sweepDrain(300);
    expect(await expireStats(c, runIds)).toEqual({
      expired: 250,
      tasksClosed: 250,
      runEndOne: 250,
      runEnd: 250,
      posted: 0,
    });
    // Không có seam đếm `postThread` qua deps hub (helper chỉ có `postThreadOnce`); `processLoops:false` ⇒ thread-poster
    // không chạy ⇒ `posted_at` khác NULL chỉ có thể do vòng hết hạn tự đăng. Lượt sau: không còn gì hết hạn.
    expect(Number(((await sweepN(c)) as Json)?.expired ?? 0)).toBe(0);
  }, 120_000);
});

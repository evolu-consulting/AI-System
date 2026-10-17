// HUB-FR-112 · HUB-FR-115 · PD-R18 · CR-093 · plan-addendum A10 (NFR) · PD-P13, PD-P14 (test-plan-addendum §2 "Hiệu năng
// vòng nền"): lô 100 p95 ≤ 50 ms qua 20 lô; 10.000 task nhắc ≤ 6 s; 20.000 run hết hạn ≤ 12 s. Ngưỡng là `expect` (NFR A10).
// Chỉ chạy trong `bun run test:perf` (không `test:int`). Đồng hồ giả `c.clk` (hạn đặt sẵn quá khứ), không chờ giờ thật.
// Đo: mỗi lô = MỘT lời gọi `remindOnce`/`sweepOnce` khi có đúng 100 hàng tới hạn (fixture chèn ngoài khoảng đo); tải lớn =
// tổng thời gian gọi lặp tới khi lượt trả 0 (dừng sớm khi quá 4× ngân sách để đỏ nhanh). Cột cũ (0019) ⇒ `needSchema`.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { needSchema } from "../../P-a/_support/schema";
import { type CtxPd, type Json, remind, startPd, sweepN } from "../_support/pd";
import { dueReviewTasks, expireStats, expiringRuns, remindStats } from "../d1/_load";

let c: CtxPd;
beforeAll(async () => {
  c = await startPd({ processRunsPerTenant: 50_000 });
}, 60_000);
afterAll(async () => {
  await c?.stop();
});

const ROUNDS = 20;
const P95_MS = 50;
const pct = (xs: number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)] ?? 0;
};
const expiredOf = (r: unknown) => Number((r as Json)?.expired ?? 0);

/** Gọi `once` tới khi trả 0 hàng (`count`) hoặc quá `capMs`. Trả tổng ms + số lượt. */
async function drain(once: () => Promise<number>, capMs: number) {
  const t0 = performance.now();
  let calls = 0;
  while (performance.now() - t0 < capMs) {
    calls++;
    if ((await once()) === 0) break;
  }
  return { ms: Math.round(performance.now() - t0), calls };
}

describe("PD-P13 · lô nhắc 100 [HUB-FR-112, PD-R18, A10]", () => {
  it("HUB-FR-112 · PD-P13 · 20 lô × 100 task tới hạn ⇒ mỗi remindOnce nhắc đủ 100, p95 ≤ 50 ms; 10.000 task tới hạn ⇒ nhắc xong ≤ 6 s, 20.000 notice, 0 trùng", async () => {
    needSchema(c.ready);
    await remind(c); // khởi động
    const ms: number[] = [];
    let short = 0;
    for (let i = 0; i < ROUNDS; i++) {
      const ids = await dueReviewTasks(c, 100);
      const t0 = performance.now();
      await remind(c);
      ms.push(performance.now() - t0);
      if ((await remindStats(c, ids)).reminded !== 100) short++;
    }
    const p95 = Math.round(pct(ms, 0.95));
    const big = await dueReviewTasks(c, 10_000);
    const d = await drain(() => remind(c), 4 * 6_000);
    const st = await remindStats(c, big);
    console.log(
      `PD-P13 lô100 ms=${ms.map((x) => Math.round(x)).join(",")} p50=${Math.round(pct(ms, 0.5))} p95=${p95}; ` +
        `10.000 task: ${d.ms} ms / ${d.calls} lượt, nhắc=${st.reminded}`,
    );
    expect({ loThieu: short, p95Le50: p95 <= P95_MS }).toEqual({ loThieu: 0, p95Le50: true });
    expect({ ms10k: d.ms, le6s: d.ms <= 6_000 }).toEqual({ ms10k: d.ms, le6s: true });
    expect(st).toEqual({ reminded: 10_000, notices: 20_000, dupPairs: 0 });
  }, 600_000);
});

describe("PD-P14 · lô hết hạn 100 [HUB-FR-115, A10]", () => {
  it("HUB-FR-115 · PD-P14 · 20 lô × 100 run hết hạn ⇒ mỗi sweepOnce hết hạn đủ 100, p95 ≤ 50 ms; 20.000 run hết hạn ⇒ xong ≤ 12 s", async () => {
    needSchema(c.ready);
    await sweepN(c); // khởi động + dọn tồn
    const ms: number[] = [];
    let short = 0;
    for (let i = 0; i < ROUNDS; i++) {
      const { runIds } = await expiringRuns(c, 100);
      const t0 = performance.now();
      await sweepN(c);
      ms.push(performance.now() - t0);
      if ((await expireStats(c, runIds)).expired !== 100) short++;
    }
    const p95 = Math.round(pct(ms, 0.95));
    const big = await expiringRuns(c, 20_000);
    const d = await drain(async () => expiredOf(await sweepN(c)), 4 * 12_000);
    const st = await expireStats(c, big.runIds);
    console.log(
      `PD-P14 lô100 ms=${ms.map((x) => Math.round(x)).join(",")} p50=${Math.round(pct(ms, 0.5))} p95=${p95}; ` +
        `20.000 run: ${d.ms} ms / ${d.calls} lượt, expired=${st.expired}`,
    );
    expect({ loThieu: short, p95Le50: p95 <= P95_MS }).toEqual({ loThieu: 0, p95Le50: true });
    expect({ ms20k: d.ms, le12s: d.ms <= 12_000 }).toEqual({ ms20k: d.ms, le12s: true });
    expect({ expired: st.expired, tasksClosed: st.tasksClosed, runEndOne: st.runEndOne }).toEqual({
      expired: 20_000,
      tasksClosed: 20_000,
      runEndOne: 20_000,
    });
  }, 900_000);
});

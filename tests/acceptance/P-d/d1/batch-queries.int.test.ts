// HUB-FR-112 · HUB-FR-115 · CR-093 · plan-addendum A10 · PD-P15 (test-plan-addendum §2 "Hiệu năng vòng nền"): vòng nền
// xử lý THEO TẬP — số câu SQL mỗi lô không phụ thuộc số hàng: nhắc ≤ 6 câu/lô, hết hạn ≤ 6 câu/lô (đếm qua `debug` của pool
// postgres.js Hub, `_count.ts`). Lô 10 hàng so với lô 99 hàng (cùng MỘT lô < 100 — lô 100 sẽ kéo thêm lô rỗng theo A9).
// Chống nhiễu từ việc nền khác của Hub (nạp cache cấu hình, postgres.js nạp kiểu mảng): khởi động trước một lượt rỗng, mỗi cỡ
// lô đo 2 lần lấy MIN (nhiễu chỉ cộng thêm câu). Cột cũ (0019) ⇒ `needSchema(c.ready)`.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { needSchema } from "../../P-a/_support/schema";
import { type CtxPd, type Json, remind, startPd, sweepN } from "../_support/pd";
import { countQueries } from "./_count";
import { dueReviewTasks, expireStats, expiringRuns, remindStats } from "./_load";

let c: CtxPd;
beforeAll(async () => {
  c = await startPd({ processRunsPerTenant: 2_000 });
}, 60_000);
afterAll(async () => {
  await c?.stop();
});

const MAX_PER_BATCH = 6;

/** Hai lần (chèn `n` hàng rồi đo một lượt) ⇒ số câu nhỏ nhất + câu của lần đó + mọi id đã chèn. */
async function minOf2(
  seed: () => Promise<string[]>,
  once: () => Promise<unknown>,
): Promise<{ n: number; queries: string[]; ids: string[]; r: unknown }> {
  const ids: string[] = [];
  let best: { n: number; queries: string[]; r: unknown } | null = null;
  for (let i = 0; i < 2; i++) {
    ids.push(...(await seed()));
    const q = await countQueries(c.hub, once);
    if (!best || q.n < best.n) best = q;
  }
  return { ...(best as { n: number; queries: string[]; r: unknown }), ids };
}

describe("PD-P15 · số câu SQL mỗi lô không phụ thuộc số hàng [HUB-FR-112, HUB-FR-115, A10]", () => {
  it("HUB-FR-112 · PD-P15 · vòng nhắc: lô 10 task và lô 99 task tới hạn ⇒ mỗi remindOnce ≤ 6 câu SQL, hai lô cùng số câu", async () => {
    needSchema(c.ready);
    await remind(c); // khởi động (lượt rỗng)
    const q10 = await minOf2(
      () => dueReviewTasks(c, 10),
      () => remind(c),
    );
    const q99 = await minOf2(
      () => dueReviewTasks(c, 99),
      () => remind(c),
    );
    console.log(`PD-P15 nhắc: lô10=${q10.n} câu, lô99=${q99.n} câu\n  ${q10.queries.join("\n  ")}`);
    expect((await remindStats(c, q10.ids)).reminded).toBe(20);
    expect((await remindStats(c, q99.ids)).reminded).toBe(198);
    expect({ lo10: q10.n <= MAX_PER_BATCH, lo99: q99.n <= MAX_PER_BATCH, n10: q10.n }).toEqual({
      lo10: true,
      lo99: true,
      n10: q99.n,
    });
  }, 60_000);

  it("HUB-FR-115 · PD-P15 · vòng hết hạn: lô 10 run và lô 99 run hết hạn ⇒ phần hết hạn của sweepOnce ≤ 6 câu SQL (so lượt nền rỗng), hai lô cùng số câu", async () => {
    needSchema(c.ready);
    await sweepN(c); // khởi động + dọn tồn
    const q0 = await minOf2(
      async () => [],
      () => sweepN(c),
    );
    const q10 = await minOf2(
      async () => (await expiringRuns(c, 10)).runIds,
      () => sweepN(c),
    );
    const q99 = await minOf2(
      async () => (await expiringRuns(c, 99)).runIds,
      () => sweepN(c),
    );
    console.log(
      `PD-P15 hết hạn: nền=${q0.n} câu, lô10=${q10.n}, lô99=${q99.n}\n  ${q10.queries.join("\n  ")}`,
    );
    expect(Number((q10.r as Json)?.expired)).toBe(10);
    expect((await expireStats(c, q10.ids)).expired).toBe(20);
    expect((await expireStats(c, q99.ids)).expired).toBe(198);
    const d10 = q10.n - q0.n;
    const d99 = q99.n - q0.n;
    expect({ lo10: d10 <= MAX_PER_BATCH, lo99: d99 <= MAX_PER_BATCH, n10: q10.n }).toEqual({
      lo10: true,
      lo99: true,
      n10: q99.n,
    });
  }, 60_000);
});

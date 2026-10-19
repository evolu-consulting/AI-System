// HD-FR-35 · HD-FR-36 · HD3 spec §4 (Luật 4c): số đo flow duyệt — (1) lượt quét với lô 100 HĐ trong flow (đọc + `outcomesOf`)
// p95 ≤ 50 ms; (2) lô 100 HĐ `extracting` quá hạn đóng bằng MỘT câu ghi (closed = 100, lượt sau 0); (3) `GET …/approval`
// p95 ≤ 30 ms. In số thật (p50/p95/max). Không ngưỡng nào dựa vào ngủ chờ.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { PA } from "../P-d/_support/pd";
import { approval, C1_TEXT, type CtxHd3, cid, seedContract, startHd3, T, toLevel1 } from "./_hd3";

let c: CtxHd3;
beforeAll(async () => {
  c = await startHd3();
}, 180_000);
afterAll(async () => {
  await c?.stop();
});

const pct = (xs: number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))] ?? 0;
};
const stats = (xs: number[]) => ({
  p50: +pct(xs, 0.5).toFixed(1),
  p95: +pct(xs, 0.95).toFixed(1),
  max: +Math.max(...xs).toFixed(1),
});

async function seedBatch(from: number, n: number, o: { stale: boolean }) {
  const rows = Array.from({ length: n }, (_, i) => ({
    id: cid(from + i),
    tenant_id: T.acme,
    title: `HĐ ${from + i}`,
    status: o.stale ? "extracting" : "needs_review",
    created_by: PA.A.id,
    source_text: C1_TEXT,
    run_id: o.stale ? null : crypto.randomUUID(),
    updated_at: o.stale ? new Date(Date.now() - 30 * 60_000) : new Date(),
  }));
  await c.sql`insert into contracts.contracts ${c.sql(rows)}`;
}

describe("HD3 perf [HD-FR-35, HD-FR-36]", () => {
  it("quét: lô 100 HĐ trong flow ⇒ p95 ≤ 50 ms; lô 100 quá hạn ⇒ đóng 100 bằng 1 lượt, lượt sau 0", async () => {
    await seedBatch(1000, 100, { stale: false });
    await c.sweepOnce(); // làm nóng kết nối/kế hoạch
    const ms: number[] = [];
    for (let i = 0; i < 30; i++) {
      const t0 = performance.now();
      const s = await c.sweepOnce();
      ms.push(performance.now() - t0);
      expect(s.read).toBeGreaterThanOrEqual(100);
    }
    const read = stats(ms);
    await seedBatch(2000, 100, { stale: true });
    const t0 = performance.now();
    const closed = await c.sweepOnce();
    const closeMs = +(performance.now() - t0).toFixed(1);
    console.log(
      `HD3-P01 quét đọc lô 100: ${JSON.stringify(read)} ms; đóng 100 quá hạn: ${closeMs} ms`,
    );
    expect(closed.closed).toBe(100);
    expect((await c.sweepOnce()).closed).toBe(0);
    expect(read.p95).toBeLessThanOrEqual(50);
  }, 120_000);

  it("GET approval (HĐ ở cấp 1) ⇒ p95 ≤ 30 ms", async () => {
    const id = await seedContract(c, 90);
    await toLevel1(c, id, 1_000);
    for (let i = 0; i < 5; i++) await approval(c, "B", id);
    const ms: number[] = [];
    for (let i = 0; i < 40; i++) {
      const t0 = performance.now();
      const r = await approval(c, "B", id);
      ms.push(performance.now() - t0);
      expect(r.status).toBe(200);
    }
    const s = stats(ms);
    console.log(`HD3-P02 GET approval: ${JSON.stringify(s)} ms`);
    expect(s.p95).toBeLessThanOrEqual(30);
  }, 120_000);
});

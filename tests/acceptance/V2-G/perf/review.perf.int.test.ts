// V2-G · Luật 4c: THỜI GIAN "Lưu" màn xác nhận 200 dòng + 50 mốc (tenant tắt duyệt) — p95 ≤ 250 ms trong mạng cục bộ.
// Tách khỏi `../perf.int.test.ts` (đếm số câu SQL — tất định, chạy trong int): p95 phụ thuộc tải máy nên theo luật chung chỉ đo ở
// bộ perf (`*.perf.int.test.ts` bị bunfig.int.toml bỏ qua): `bun run test:perf` / `run-tests.ps1 -Step perf [-Exclusive]`. Làm nóng
// (pool, plan cache, JIT) 3 lượt không tính; số thật in ra.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { CtxN1 } from "../_support/v2g";
import {
  arrangeV2a,
  d,
  needV2g,
  restoreApproval,
  reviewOf,
  seedReview,
  setApproval,
  startHd1,
  T,
} from "../_support/v2g";

const WARM = 3;
const RUNS = 12;
const P95_MS = 250;

let c: CtxN1;
beforeAll(async () => {
  c = await startHd1();
  await needV2g(c.sql);
}, 120_000);
afterAll(async () => {
  if (c) await restoreApproval(c.sql);
  await c?.stop();
});

const ai = { deal: "sell", unsure: [], summary: null, milestones: [] };
const lines = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ name: `Hàng ${i}`, qty: 1, unit_price: 1000 + i }));
const ms = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    kind: "collect",
    title: `Đợt ${i}`,
    due_date: d(10 + i),
    amount: 1000,
  }));

/** Chuẩn bị (KHÔNG tính giờ; arrange/TRUNCATE chỉ 1 lần ngoài vòng đo): HĐ chờ xác nhận có 200 dòng, thân Lưu = sửa 200 dòng + 1 dòng mới + 50 mốc. */
async function prepare() {
  const s = await seedReview(c, 1, { deal: "sell", ai, items: lines(200) });
  const items = s.items.map((id, i) => ({ id, name: `Hàng ${i} sửa`, qty: 2, unit_price: 2000 }));
  return {
    id: s.id,
    body: {
      version: 1,
      fields: { title: "Lưu" },
      items: [...items, { name: "Mới" }],
      milestones: ms(50),
    },
  };
}

describe("V2-G · Lưu 200 dòng + 50 mốc: thời gian (perf)", () => {
  it(`p95 ≤ ${P95_MS} ms (tenant tắt duyệt, ${RUNS} lượt sau ${WARM} lượt làm nóng)`, async () => {
    const times: number[] = [];
    await arrangeV2a(c);
    await setApproval(c.sql, T.acme, false);
    const prepared = [];
    for (let i = 0; i < WARM + RUNS; i++) prepared.push(await prepare());
    for (const [i, { id, body }] of prepared.entries()) {
      const t0 = performance.now();
      const r = await reviewOf(c, id, body);
      const ms1 = performance.now() - t0;
      expect(r.status).toBe(200);
      if (i >= WARM) times.push(ms1);
    }
    times.sort((x, y) => x - y);
    const p = (q: number) => times[Math.min(times.length - 1, Math.floor(q * times.length))] ?? 0;
    console.log(
      `V2-G review 200x50 (sau làm nóng): p50 ${p(0.5).toFixed(1)} ms · p95 ${p(0.95).toFixed(1)} ms · max ${(times.at(-1) ?? 0).toFixed(1)} ms`,
    );
    expect(p(0.95)).toBeLessThanOrEqual(P95_MS);
  }, 120_000);
});

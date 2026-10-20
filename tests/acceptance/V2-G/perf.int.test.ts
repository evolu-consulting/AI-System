// V2-G · Luật 4c: "Lưu" màn xác nhận = SỐ CÂU SQL CỐ ĐỊNH, không phụ thuộc số dòng hàng / số mốc (dữ liệu lô qua MỘT tham số JSON mỗi loại);
// chi tiết vẫn MỘT câu đọc kể cả có `ai` + dòng gắn SP; gắn SP một dòng = số câu cố định. Đo thời gian Lưu 200 dòng + 50 mốc (số thật in ra).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { captureSql } from "../HD1/_support/hd1";
import {
  arrangeV2a,
  type CtxN1,
  call,
  d,
  needV2g,
  ok,
  P,
  restoreApproval,
  reviewOf,
  seedReview,
  setApproval,
  startHd1,
  T,
} from "./_support/v2g";

let c: CtxN1;
beforeAll(async () => {
  c = await startHd1();
  await needV2g(c.sql);
}, 120_000);
afterAll(async () => {
  if (c) await restoreApproval(c.sql);
  await c?.stop();
});

const TX = 1; // `set_config` tenant/user đầu mỗi tx
const count = async (fn: () => Promise<unknown>) => (await captureSql(c, fn)).queries.length;
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

async function save(n: number, k: number, approval: boolean, ver = 1) {
  await arrangeV2a(c);
  await setApproval(c.sql, T.acme, approval);
  const s = await seedReview(c, 1, { deal: "sell", ai, items: lines(n) });
  const items = s.items.map((id, i) => ({ id, name: `Hàng ${i} sửa`, qty: 2, unit_price: 2000 }));
  const body = {
    version: ver,
    fields: { title: "Lưu" },
    items: [...items, { name: "Mới" }],
    milestones: ms(k),
  };
  return { s, body };
}

describe("V2-G · Lưu: số câu SQL cố định (Luật 4c)", () => {
  it.each([false, true])(
    "approval_on=%p · 3 dòng + 2 mốc = 200 dòng + 50 mốc (cùng số câu)",
    async (approval) => {
      const a = await save(3, 2, approval);
      const nSmall = await count(() => ok(reviewOf(c, a.s.id, a.body)));
      const b = await save(200, 50, approval);
      const nBig = await count(() => ok(reviewOf(c, b.s.id, b.body)));
      // khoá + (HĐ + dòng/mốc + xác nhận) + outbox = cố định; đo thật in ra để theo dõi
      console.log(
        `V2-G review statements (approval_on=${approval}): 3x2 = ${nSmall} · 200x50 = ${nBig}`,
      );
      expect(nBig).toBe(nSmall);
      expect(nSmall).toBeLessThanOrEqual(TX + 6);
    },
  );

  it("chi tiết có `ai` + 200 dòng gắn SP vẫn MỘT câu đọc; gắn SP một dòng = số câu cố định", async () => {
    const { s, body } = await save(200, 5, false);
    await ok(reviewOf(c, s.id, body));
    const get = () => ok(call(c, P.hoa, "GET", `/contracts/${s.id}`));
    await get();
    expect(await count(get)).toBe(TX + 1);
    const p = await ok(call(c, P.hoa, "POST", "/products", { name: "SP", group: "goods" }));
    const first = (await get()).items[0].id;
    const attach = () =>
      ok(call(c, P.hoa, "PUT", `/contracts/${s.id}/items/${first}/product`, { product_id: p.id }));
    await attach();
    expect(await count(attach)).toBeLessThanOrEqual(TX + 2);
  });

  it("thời gian: Lưu 200 dòng + 50 mốc (tenant tắt duyệt) — p95 ≤ 250 ms trong mạng cục bộ", async () => {
    const times: number[] = [];
    for (let i = 0; i < 12; i++) {
      const { s, body } = await save(200, 50, false);
      const t0 = performance.now();
      const r = await reviewOf(c, s.id, body);
      times.push(performance.now() - t0);
      expect(r.status).toBe(200);
    }
    times.sort((x, y) => x - y);
    const p = (q: number) => times[Math.min(times.length - 1, Math.floor(q * times.length))] ?? 0;
    console.log(
      `V2-G review 200x50: p50 ${p(0.5).toFixed(1)} ms · p95 ${p(0.95).toFixed(1)} ms · max ${(times.at(-1) ?? 0).toFixed(1)} ms`,
    );
    expect(p(0.95)).toBeLessThanOrEqual(250);
  });
});

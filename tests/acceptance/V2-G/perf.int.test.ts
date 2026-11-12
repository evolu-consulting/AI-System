// V2-G · Luật 4c: "Lưu" màn xác nhận = SỐ CÂU SQL CỐ ĐỊNH, không phụ thuộc số dòng hàng / số mốc (dữ liệu lô qua MỘT tham số JSON mỗi loại);
// chi tiết vẫn MỘT câu đọc kể cả có `ai` + dòng gắn SP; gắn SP một dòng = số câu cố định. Thời gian Lưu 200 dòng + 50 mốc (p95): perf/review.perf.int.test.ts (bộ perf, không phụ thuộc tải máy int).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { withFlowEngine } from "../_support/flow-engine";
import { captureSql } from "../HD1/_support/hd1";
import {
  arrangeV2a,
  type CtxN1,
  call,
  d,
  type Json,
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
  it("Xác nhận & lưu (có quy trình khớp): 3 dòng + 2 mốc = 200 dòng + 50 mốc (cùng số câu)", async () => {
    const run = (id: string, body: Json) => () =>
      withFlowEngine(async () => ok(reviewOf(c, id, body)));
    const a = await save(3, 2, false);
    const nSmall = await count(run(a.s.id, a.body));
    const b = await save(200, 50, false);
    const nBig = await count(run(b.s.id, b.body));
    console.log(`V2-G review statements: 3x2 = ${nSmall} · 200x50 = ${nBig}`);
    expect(nBig).toBe(nSmall);
    // CR-127: "Xác nhận & lưu" = lưu + gắn SP + Gửi (submit/cổng/outbox) trong một tx ⇒ trần cố định 20 câu (đo thực 16), không phụ thuộc số dòng/mốc.
    expect(nSmall).toBeLessThanOrEqual(20);
  });

  it("chi tiết có `ai` + 200 dòng gắn SP = số câu như 3 dòng (không theo số dòng); gắn SP một dòng = số câu cố định", async () => {
    const small = await save(3, 2, false);
    const getSmall = () => ok(call(c, P.hoa, "GET", `/contracts/${small.s.id}`));
    await getSmall();
    const nSmall = await count(getSmall);
    const { s, body } = await save(200, 5, false);
    const get = () => ok(call(c, P.hoa, "GET", `/contracts/${s.id}`));
    await get();
    // CR-127: chi tiết HĐ Nháp đọc thêm (SG1 `submit_block`, hồ sơ lần gửi, nghĩa vụ…) ⇒ hằng số, tính theo TX + 5 (đo thực 6); chặn tăng theo dòng.
    expect(await count(get)).toBe(nSmall);
    expect(nSmall).toBeLessThanOrEqual(TX + 5);
    const p = await ok(call(c, P.hoa, "POST", "/products", { name: "SP", group: "goods" }));
    const first = (await get()).items[0].id;
    const attach = () =>
      ok(call(c, P.hoa, "PUT", `/contracts/${s.id}/items/${first}/product`, { product_id: p.id }));
    await attach(); // lock-strict: gắn SP chỉ khi HĐ chưa khoá ⇒ đo trước khi xác nhận
    expect(await count(attach)).toBeLessThanOrEqual(TX + 2);
    await withFlowEngine(async () => ok(reviewOf(c, s.id, body)));
  });
});

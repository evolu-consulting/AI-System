// V2-D · Luật 4c: xác nhận một mốc giao = SỐ CÂU SQL CỐ ĐỊNH, không phụ thuộc số dòng (1 dòng = 20 dòng): khoá HĐ + khoá mốc + MỘT
// câu nạp (dòng HĐ, đã giao, kế hoạch, thành phần) + 4 câu `applyDelivery` + MỘT CTE ghi (mốc + SL đã giao + sổ đối tác + nhật ký).
// Đếm câu pool hub gửi (`captureSql` của HD1; tính cả `set_config` đầu tx). p95 đo ở `perf/confirm.perf.int.test.ts` (PERF=1).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { captureSql } from "../HD1/_support/hd1";
import {
  addDelivery,
  arrangeV2d,
  type CtxN1,
  d,
  deal,
  item,
  ok,
  product,
  settleRaw,
  startHd1,
  stockIn,
} from "./_support/v2d";

let c: CtxN1;
beforeAll(async () => {
  c = await startHd1();
}, 120_000);
afterAll(async () => {
  await c?.stop();
});

const TX = 1;
const STMTS = 9; // lockContractOf + lockObligation + nạp + 4 applyDelivery + ghi + notify.enqueue (gap-c: một câu cố định mỗi lô, không theo số dòng)

async function contractWith(n: number, sale: boolean, products: string[]): Promise<string> {
  const k = await deal(c.sql, { sale, end: d(365) });
  for (let i = 0; i < n; i++)
    await item(c.sql, k, { qty: 1_000, price: 10_000, productId: products[i] as string });
  return k;
}

describe("V2-D · xác nhận mốc giao: số câu SQL cố định (Luật 4c)", () => {
  it("1 dòng = 20 dòng; Mua và Bán như nhau", async () => {
    await arrangeV2d(c);
    const ps: string[] = [];
    for (let i = 0; i < 20; i++) {
      const p = await product(c.sql, { name: `SP perf ${i}`, grp: "goods" });
      ps.push(p.id);
      await stockIn(c, p.id, 100, 9_000);
    }
    const run = async (n: number, sale: boolean) => {
      const m = await addDelivery(c, await contractWith(n, sale, ps));
      const cap = await captureSql(c, () => ok(settleRaw(c, m, undefined, { at: d(0) })));
      return cap.queries.length;
    };
    await run(1, false); // ấm
    const counts = [
      await run(1, false),
      await run(20, false),
      await run(1, true),
      await run(20, true),
    ];
    expect(counts).toEqual([TX + STMTS, TX + STMTS, TX + STMTS, TX + STMTS]);
  });

  it("mốc giao của HĐ không gắn SP: không thêm câu kho (khoá + nạp + ghi)", async () => {
    await arrangeV2d(c);
    const k = await deal(c.sql, { sale: false });
    await item(c.sql, k, { qty: 5, price: 1 });
    const m = await addDelivery(c, k);
    const cap = await captureSql(c, () => ok(settleRaw(c, m, undefined, { at: d(0) })));
    expect(cap.queries.length).toBe(TX + 4);
  });
});

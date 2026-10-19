// HD9-AC09 · D9-21 · Luật 4c: số câu SQL mỗi request CKS là HẰNG (không theo số chữ ký/người giữ). Đọc = 1 câu nghiệp vụ;
// bán/hoàn tất = khoá + kiểm + ghi (+ outbox HĐ) với 1 và 50 người giữ như nhau. Chạy trong `test:int:par` (không cần PERF=1).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  arrangeCks,
  type CtxN1,
  captureSql,
  d,
  kcall,
  ok,
  P,
  startHd1,
  world,
} from "./_support/hd9";

let c: CtxN1;
beforeAll(async () => {
  c = await startHd1();
}, 60_000);
afterAll(async () => {
  await c?.stop();
});

const count = async (fn: () => Promise<unknown>) => (await captureSql(c, fn)).queries.length;
const lot = (qty: number) =>
  ok(
    kcall(c, P.hoa, "POST", "/lots", {
      ca: "Viettel-CA",
      qty,
      unit_cost: 1,
      bought_at: d(-1),
      device: "token",
    }),
  );
const holders = (n: number, tag: string) =>
  Array.from({ length: n }, (_, i) => ({
    name: `H${i}`,
    device: "token",
    serial: `${tag}${i.toString(16)}`,
  }));

describe("HD9-AC09 · số câu SQL cố định", () => {
  it("đọc: overview, customers, customers/:id, lots, prices, signed-docs ⇒ câu đặt phạm vi tx + đúng 1 câu nghiệp vụ", async () => {
    await arrangeCks(c);
    const w = await world(c);
    const id = (await kcall(c, P.tam, "GET", "/customers")).json.items[0].company_id;
    for (const path of [
      "/overview",
      `/customers/${id}`,
      "/lots",
      "/prices",
      `/signed-docs?customer_id=${id}`,
    ]) {
      expect({ path, n: await count(() => kcall(c, P.tam, "GET", path)) }).toEqual({ path, n: 2 });
    }
    // Danh sách khách có trang: chọn id trang + chữ ký của trang = 2 câu, cố định theo cỡ trang/số khách.
    for (const q of ["", "?page_size=1", "?q=viet&filter=expiring"])
      expect({ q, n: await count(() => kcall(c, P.tam, "GET", `/customers${q}`)) }).toEqual({
        q,
        n: 3,
      });
    expect(w.lot.id).toBeString();
  });
  it("bán 1 và 50 người giữ, hoàn tất gia hạn 1 và 50 chữ ký ⇒ cùng số câu (phạm vi tx + khoá + kiểm + ghi + outbox/kiểm serial = 5)", async () => {
    await arrangeCks(c);
    const big = await lot(100);
    const sale = (n: number, tag: string, name: string) =>
      kcall(c, P.hoa, "POST", "/sales", {
        company_name: name,
        lot_id: big.id,
        price_each: 1,
        signed_at: d(-10),
        valid_to: d(300),
        holders: holders(n, tag),
      });
    const n1 = await count(() => sale(1, "A0", "Một"));
    const n50 = await count(() => sale(50, "B0", "Năm mươi"));
    expect({ n1, n50 }).toEqual({ n1: 5, n50: 5 });
    const one = await ok(sale(1, "C0", "Ba"));
    const fifty = await ok(sale(40, "D0", "Bốn mươi"));
    const r1 = await ok(kcall(c, P.hoa, "POST", `/groups/${one.contract_id}/renew`, {}));
    const r50 = await ok(kcall(c, P.hoa, "POST", `/groups/${fifty.contract_id}/renew`, {}));
    const s = (ids: string[], tag: string) =>
      Object.fromEntries(ids.map((x, i) => [x, `${tag}${i.toString(16)}`]));
    const c1 = await count(() =>
      kcall(c, P.hoa, "POST", `/renewals/${r1.id}/complete`, {
        serials: s(r1.certificate_ids, "E0"),
        valid_to: null,
      }),
    );
    const c50 = await count(() =>
      kcall(c, P.hoa, "POST", `/renewals/${r50.id}/complete`, {
        serials: s(r50.certificate_ids, "F0"),
        valid_to: null,
      }),
    );
    expect({ c1, c50 }).toEqual({ c1: 5, c50: 5 });
  });
});

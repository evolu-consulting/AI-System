// products-confirm · BA 5.5e (khách 2026-10-22) — xoá HĐ: xem trước liệt kê SP gắn HĐ mà không còn HĐ nào khác dùng; chỉ SP người
// xoá tick mới bị xoá (kể cả SP chỉ gắn qua dòng HĐ, không sinh từ HĐ); SP không tick giữ lại; SP còn HĐ khác dùng không bao giờ bị xoá
// (tick cũng không). Xoá không kèm lựa chọn ⇒ không xoá SP nào.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  arrangeV2d,
  type CtxN1,
  call,
  d,
  deal,
  item,
  ok,
  P,
  product,
  startHd1,
} from "../V2-D/_support/v2d";

let c: CtxN1;
beforeAll(async () => {
  c = await startHd1();
}, 120_000);
afterAll(async () => {
  await c?.stop();
});

const alive = async (ids: string[]) =>
  (
    await c.sql<
      { id: string }[]
    >`select id::text from contracts.products where id = any(${ids}::uuid[]) order by name`
  ).map((r) => r.id);

describe("products-confirm · xoá HĐ chọn SP mồ côi", () => {
  it("chỉ SP được tick + mồ côi bị xoá; SP còn HĐ khác dùng giữ nguyên", async () => {
    await arrangeV2d(c);
    const pick = await product(c.sql, { name: "PC Chọn", grp: "goods" });
    const keep = await product(c.sql, { name: "PC Giữ", grp: "goods" });
    const shared = await product(c.sql, { name: "PC Dùng chung", grp: "goods" });
    const k = await deal(c.sql, { sale: true, end: d(100) });
    const other = await deal(c.sql, { sale: true, end: d(100) });
    await item(c.sql, k, { qty: 1, price: 10, productId: pick.id });
    await item(c.sql, k, { qty: 1, price: 10, productId: keep.id });
    await item(c.sql, k, { qty: 1, price: 10, productId: shared.id });
    await item(c.sql, other, { qty: 1, price: 10, productId: shared.id });

    const pv = await ok(call(c, P.lan, "GET", `/contracts/${k}/delete-preview`));
    expect(pv.orphan_products.map((p: { id: string }) => p.id).sort()).toEqual(
      [pick.id, keep.id].sort(),
    );
    const r = await ok(
      call(c, P.lan, "DELETE", `/contracts/${k}`, { remove_products: [pick.id, shared.id] }),
    );
    expect(r.impact.products).toBe(1);
    expect((await alive([pick.id, keep.id, shared.id])).sort()).toEqual(
      [keep.id, shared.id].sort(),
    );

    // không kèm lựa chọn ⇒ không xoá SP nào (SP dùng chung giờ mồ côi vẫn còn)
    await ok(call(c, P.lan, "DELETE", `/contracts/${other}`));
    expect(await alive([shared.id])).toEqual([shared.id]);
  });
});

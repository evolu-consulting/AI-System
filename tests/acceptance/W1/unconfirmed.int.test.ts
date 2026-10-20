// W1 · UAT CR-095 B5: đợt thanh toán của HĐ CHƯA xác nhận (needs_review — kể cả HĐ vừa bị mở lại duyệt do sửa MST) không vào
// "Việc của tôi" và bảng Thanh toán (dòng, tổng, quá hạn), như mgmt-app (đợt chỉ có sau khi HĐ được xác nhận). Xác nhận lại ⇒ hiện lại.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  addObligation,
  arrangeW1,
  type CtxN1,
  call,
  d,
  myWork,
  P,
  priced,
  startHd1,
} from "./_support/w1";

let c: CtxN1;
beforeAll(async () => {
  c = await startHd1();
}, 120_000);
afterAll(async () => {
  await c?.stop();
});

const board = async (filter = "all") =>
  (await call(c, P.hoa, "GET", `/payments?filter=${filter}`)).json;
const obIds = (b: { rows: { id: string }[] }) => b.rows.map((r) => r.id);

describe("W1 · UAT B5: chỉ HĐ đã xác nhận có việc tiền", () => {
  it("HĐ chờ xác nhận (needs_review): đợt trễ hạn và sắp tới không hiện ở Việc của tôi / Thanh toán / tổng; xác nhận ⇒ hiện", async () => {
    await arrangeW1(c);
    const ok = await priced(c.sql, { partner: "Công ty Tân Phát", number: "T-1", items: [] });
    const wait = await priced(c.sql, {
      partner: "Công ty Minh Phát",
      number: "T-2",
      items: [],
      status: "needs_review",
    });
    const okLate = await addObligation(c.sql, ok, { due: d(-3), amount: 1_000_000 });
    const waitLate = await addObligation(c.sql, wait, { due: d(-3), amount: 250_000_000 });
    const waitSoon = await addObligation(c.sql, wait, { due: d(2), amount: 250_000_000, seq: 2 });

    const mine = (await myWork(c, P.hoa)).json.items.map((i: { id: string }) => i.id);
    expect(mine).toContain(`obligation:${okLate}`);
    expect(mine.filter((x: string) => x.endsWith(waitLate) || x.endsWith(waitSoon))).toEqual([]);

    const all = await board();
    expect(obIds(all)).toEqual([okLate]);
    expect([
      all.total,
      all.stats.pay_open,
      all.stats.overdue_count,
      all.stats.overdue_amount,
    ]).toEqual([1, "1000000", 1, "1000000"]);
    expect(obIds(await board("overdue"))).toEqual([okLate]);
    expect(obIds(await board("pay"))).toEqual([okLate]);

    // xác nhận ⇒ đợt hiện lại; mở lại duyệt (vd sửa MST) ⇒ ẩn lần nữa
    await c.sql`update contracts.contracts set status = 'active' where id = ${wait}`;
    expect(obIds(await board()).sort()).toEqual([okLate, waitLate, waitSoon].sort());
    await c.sql`update contracts.contracts set status = 'needs_review' where id = ${wait}`;
    expect(obIds(await board())).toEqual([okLate]);
    expect((await myWork(c, P.hoa)).json.items.map((i: { id: string }) => i.id)).not.toContain(
      `obligation:${waitLate}`,
    );
  });
  it("đợt đã xong của HĐ chờ xác nhận không vào 'Đã xong'", async () => {
    await arrangeW1(c);
    const wait = await priced(c.sql, {
      partner: "B",
      number: "T-3",
      items: [],
      status: "needs_review",
    });
    await addObligation(c.sql, wait, { due: d(-1), status: "done" });
    const done = await board("done");
    expect([done.rows, done.total]).toEqual([[], 0]);
  });
});

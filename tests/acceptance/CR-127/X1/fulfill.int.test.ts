// CR-127 · X1 · spec §2.2, §4.1, §6, §9 · BR-41, BR-46, BR-50…54: `POST /obligations/:id/fulfill` = MỘT đường ghi thực hiện vào mốc.
// Giao thiếu ⇒ mốc gốc đóng với SL thật + hàng con (keep: hạn cũ / split: hạn mới) chép `milestone_items` còn lại; thu thiếu ⇒ con
// số tiền còn lại, công nợ không đếm đôi; vượt ⇒ OVER_PLAN; tạm khoá chặn giao nhưng cho thu; yêu cầu chờ duyệt chặn; ≤ 6 câu SQL (đường
// tiền, chưa tính tín hiệu task của X5); `exec_requests` không đọc/ghi chéo tenant.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { inPackAsRollback } from "@ai/test-kit/db";
import { captureSql } from "../../HD1/_support/hd1";
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
  T,
} from "../../V2-D/_support/v2d";

let c: CtxN1;
beforeAll(async () => {
  c = await startHd1();
  await arrangeV2d(c);
}, 120_000);
afterAll(async () => {
  await c?.stop();
});

const ev = { note: "Đã nhận đủ chứng từ" };
const fulfill = (id: string, body: Record<string, unknown>) =>
  call(c, P.hoa, "POST", `/obligations/${id}/fulfill`, { evidence: ev, ...body });

/**
 * Mốc dựng bằng SQL trong setup: từ K4, sửa kế hoạch mốc qua API bị khoá khi HĐ processing/done (`CONTRACT_LOCKED`), còn ghi thực
 * hiện thì vẫn được — đúng thứ lát này kiểm.
 */
async function milestone(
  k: string,
  o: { kind: "payment" | "delivery"; direction: "pay" | "receive"; amount: number | null },
): Promise<string> {
  const [r] = await c.sql<{ id: string }[]>`insert into contracts.obligations
      (tenant_id, contract_id, direction, kind, seq, due_date, amount, owner, source)
    select ${T.acme}, ${k}, ${o.direction}, ${o.kind},
      (select coalesce(max(seq), 0) + 1 from contracts.obligations where contract_id = ${k}), ${d(5)}::date, ${o.amount},
      'partner', 'manual'
    returning id::text`;
  return (r as { id: string }).id;
}
/** HĐ mua (nhập kho) một dòng SP hàng hoá SL 10 + mốc giao 10. */
async function buyWithDelivery() {
  const k = await deal(c.sql, { sale: false, end: d(365), status: "done" });
  const p = await product(c.sql, { name: `SP ${crypto.randomUUID()}`, grp: "goods" });
  const it1 = await item(c.sql, k, { qty: 10, price: 1_000, productId: p.id });
  const m = await milestone(k, { kind: "delivery", direction: "pay", amount: null });
  await c.sql`insert into contracts.milestone_items (tenant_id, contract_id, milestone_id, contract_item_id, qty)
    values (${T.acme}, ${k}, ${m}, ${it1}, 10)`;
  return { k, it1, m };
}
/** HĐ bán + một đợt thu 1.000.000. */
async function saleWithPayment() {
  const k = await deal(c.sql, { sale: true, end: d(365), status: "done" });
  return {
    k,
    ob: await milestone(k, { kind: "payment", direction: "receive", amount: 1_000_000 }),
  };
}
const obRow = async (id: string) =>
  (
    await c.sql<
      {
        status: string;
        amount: string | null;
        due_date: string;
        parent: string | null;
        ev: string | null;
      }[]
    >`select status, amount::text, to_char(due_date, 'YYYY-MM-DD') as due_date, parent_obligation_id::text as parent,
        evidence_id::text as ev from contracts.obligations where id = ${id}`
  )[0];
const items = (id: string) =>
  c.sql<{ qty: string | null; delivered: string | null }[]>`select qty::text, delivered::text
    from contracts.milestone_items where milestone_id = ${id}`;

describe("CR-127 X1 · ghi thực hiện vào mốc", () => {
  it("giao thiếu + keep: mốc gốc đóng 4, con mở 6 giữ hạn; kho nhập 4; bằng chứng + nhật ký trước → sau", async () => {
    const { k, it1, m } = await buyWithDelivery();
    const out = await ok(fulfill(m, { qty_items: [{ contract_item_id: it1, qty: 4 }] }));
    expect(out.obligation.status).toBe("done");
    const child = out.child;
    expect(child.status).toBe("open");
    const [parent, kid] = [await obRow(m), await obRow(child.id)];
    expect(kid?.parent).toBe(m);
    expect(kid?.due_date).toBe(parent?.due_date);
    expect(parent?.ev).not.toBeNull();
    expect((await items(m)).map((x) => [Number(x.qty), Number(x.delivered)])).toEqual([[4, 4]]);
    expect((await items(child.id)).map((x) => [Number(x.qty), x.delivered])).toEqual([[6, null]]);
    const [mv] = await c.sql<{ q: string }[]>`select coalesce(sum(qty), 0)::text as q
      from contracts.stock_moves where milestone_id = ${m}`;
    expect(Number(mv?.q)).toBe(4);
    const [log] = await c.sql<
      { data: Record<string, unknown> }[]
    >`select data from contracts.contract_events
      where contract_id = ${k} and type = 'obligation_settled' order by id desc limit 1`;
    expect(log?.data.evidence_id).toBe(parent?.ev);
    expect((log?.data.after as { child_id?: string } | undefined)?.child_id).toBe(child.id);
  });

  it("giao thiếu + split: con có hạn mới + tiêu đề", async () => {
    const { it1, m } = await buyWithDelivery();
    const out = await ok(
      fulfill(m, {
        qty_items: [{ contract_item_id: it1, qty: 7 }],
        remainder: { split: { due_date: d(20), title: "Giao nốt" } },
      }),
    );
    const kid = await obRow(out.child.id);
    expect(kid?.due_date).toBe(d(20));
    expect((await items(out.child.id)).map((x) => Number(x.qty))).toEqual([3]);
  });

  it("vượt phần còn lại ⇒ 422 OVER_PLAN, mốc giữ mở", async () => {
    const { it1, m } = await buyWithDelivery();
    const r = await fulfill(m, { qty_items: [{ contract_item_id: it1, qty: 11 }] });
    expect([r.status, r.json?.error?.code ?? r.json?.code]).toEqual([422, "OVER_PLAN"]);
    expect((await obRow(m))?.status).toBe("open");
    const { ob } = await saleWithPayment();
    const r2 = await fulfill(ob, { amount: 1_000_001 });
    expect(r2.status).toBe(422);
  });

  it("thu thiếu: gốc đóng 400.000, con mở 600.000; công nợ = 600.000 (không đếm đôi)", async () => {
    const { k, ob } = await saleWithPayment();
    const out = await ok(fulfill(ob, { amount: 400_000 }));
    expect([(await obRow(ob))?.amount, (await obRow(out.child.id))?.amount]).toEqual([
      "400000",
      "600000",
    ]);
    const [open] = await c.sql<
      { s: string }[]
    >`select sum(amount)::text as s from contracts.obligations
      where contract_id = ${k} and status = 'open'`;
    expect(open?.s).toBe("600000");
  });

  it("tạm khoá: chặn giao (409 CONTRACT_ON_HOLD kèm người + lý do), vẫn cho thu tiền", async () => {
    const { k, m } = await buyWithDelivery();
    await c.sql`update contracts.contracts set exec_hold_at = now(), exec_hold_by = ${P.hoa.id}, exec_hold_reason = 'Đối tác nợ'
      where id = ${k}`;
    const r = await fulfill(m, {});
    expect([r.status, r.json?.error?.code ?? r.json?.code]).toEqual([409, "CONTRACT_ON_HOLD"]);
    expect((await obRow(m))?.status).toBe("open");
    const s = await saleWithPayment();
    await c.sql`update contracts.contracts set exec_hold_at = now(), exec_hold_by = ${P.hoa.id}, exec_hold_reason = 'x'
      where id = ${s.k}`;
    const out = await ok(fulfill(s.ob, {}));
    expect([out.obligation.status, out.child]).toEqual(["done", null]);
    const det = await ok(call(c, P.hoa, "GET", `/contracts/${s.k}`));
    expect(det.hold).toEqual({ by: P.hoa.id, reason: "x" });
  });

  it("mốc có yêu cầu thay đổi chờ duyệt ⇒ 409 CHANGE_PENDING", async () => {
    const { k, ob } = await saleWithPayment();
    await c.sql`insert into contracts.exec_requests (tenant_id, contract_id, obligation_id, kind, requested_by)
      values (${T.acme}, ${k}, ${ob}, 'postpone', ${P.hoa.id})`;
    const r = await fulfill(ob, {});
    expect([r.status, r.json?.error?.code ?? r.json?.code]).toEqual([409, "CHANGE_PENDING"]);
  });

  it("Luật 4c: thu tiền (có bằng chứng + con) ≤ 6 câu SQL", async () => {
    const { ob } = await saleWithPayment();
    const cap = await captureSql(c, () => fulfill(ob, { amount: 100_000 }));
    expect((cap.r as { status: number }).status).toBe(200);
    const qs = cap.queries.filter((q) => !/set_config/.test(q.text));
    console.log(`X1 fulfill (tiền) = ${qs.length} câu`);
    expect(qs.length).toBeLessThanOrEqual(6);
  });
});

describe("CR-127 X1 · exec_requests cách ly tenant", () => {
  it("tenant khác không đọc và không ghi được yêu cầu", async () => {
    const kb = await deal(c.sql, { sale: true, tenant: T.beta, status: "done" });
    await c.sql`insert into contracts.exec_requests (tenant_id, contract_id, kind, requested_by)
      values (${T.beta}, ${kb}, 'hold', ${P.hoa.id})`;
    const seen = await inPackAsRollback(
      "contracts",
      T.acme,
      P.hoa.id,
      (tx) => tx`select count(*)::int as n from contracts.exec_requests where contract_id = ${kb}`,
    );
    expect(seen[0]?.n).toBe(0);
    const write = inPackAsRollback(
      "contracts",
      T.acme,
      P.hoa.id,
      (tx) =>
        tx`insert into contracts.exec_requests (tenant_id, contract_id, kind, requested_by)
        values (${T.beta}, ${kb}, 'release', ${P.hoa.id})`,
    );
    await expect(write).rejects.toThrow();
  });
});

// CR-127 · X2 · spec §4.1 (`open-milestones`, `POST /contracts/deals` + `link`), §6 "Giao dịch gắn HĐ" · BR-48…51, R#19: chọn HĐ ⇒ ghi thẳng vào
// mốc (không tạo chứng từ giao dịch); "Không theo hợp đồng" ⇒ chứng từ giao dịch + lý do; LINK_REQUIRED / LINK_REASON_REQUIRED / LINK_MIXED /
// OVER_PLAN; có quy trình `transaction.saved` ⇒ yêu cầu chờ duyệt (kho/công nợ chưa đổi) rồi duyệt ⇒ ghi vào mốc, từ chối / không chạy được ⇒ không ghi.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { Tx } from "@ai/db";
import {
  flowPortRegistry,
  registerFlowEngine,
} from "../../../../apps/hub-api/src/modules/packs/kit/public";
import {
  arrangeV2d,
  type CtxN1,
  call,
  d,
  deal,
  item,
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
  registerFlowEngine(null);
  await c?.stop();
});

const ev = { note: "Đã đối chiếu phiếu nhập" };
const codeOf = (r: { json?: { error?: { code?: string }; code?: string } }) =>
  r.json?.error?.code ?? r.json?.code;

/** Mốc giao của HĐ MUA (SQL trực tiếp: HĐ DONE khoá nội dung — K4, mốc đổi qua yêu cầu thay đổi ở X3). */
async function milestone(k: string, itemId: string, qty: number): Promise<string> {
  const [o] = await c.sql<{ id: string }[]>`insert into contracts.obligations
      (tenant_id, contract_id, party_key, direction, kind, seq, due_date, source)
    select tenant_id, id, partner_key, 'pay', 'delivery', 1, current_date + 3, 'manual'
    from contracts.contracts where id = ${k} returning id::text`;
  const id = (o as { id: string }).id;
  await c.sql`insert into contracts.milestone_items (tenant_id, contract_id, milestone_id, contract_item_id, qty)
    select tenant_id, id, ${id}, ${itemId}, ${qty} from contracts.contracts where id = ${k}`;
  return id;
}

/** HĐ MUA còn hiệu lực: một dòng SP hàng hoá SL 10 + mốc giao 10. */
async function buyWithDelivery() {
  const k = await deal(c.sql, { sale: false, end: d(365), status: "done" });
  await c.sql`update contracts.contracts set effect = 'active' where id = ${k}`;
  const p = await product(c.sql, { name: `SP ${crypto.randomUUID()}`, grp: "goods" });
  const it1 = await item(c.sql, k, { qty: 10, price: 1_000, productId: p.id });
  const m = await milestone(k, it1, 10);
  const [x] = await c.sql<
    { name: string }[]
  >`select fields -> 'supplier_name' ->> 'value' as name from contracts.contracts where id = ${k}`;
  return { k, p, m, partner: x?.name as string };
}

const body = (partner: string, productId: string | null, qty: number, extra: object = {}) => ({
  deal: "buy",
  source: "invoice",
  title: "Nhập hàng",
  partner_name: partner,
  items: [
    { name: "Hàng", qty, unit_price: 1_000, ...(productId ? { product_id: productId } : {}) },
  ],
  ...extra,
});
const post = (b: object) => call(c, P.hoa, "POST", "/contracts/deals", b);
const ob = async (id: string) =>
  (await c.sql<{ status: string }[]>`select status from contracts.obligations where id = ${id}`)[0]
    ?.status;
const dealRows = async (partner: string) =>
  Number(
    (
      await c.sql<{ n: string }[]>`select count(*)::text as n from contracts.contracts
        where doc_type = 'deal' and fields -> 'supplier_name' ->> 'value' = ${partner}`
    )[0]?.n,
  );
const stockIn = async (m: string) =>
  Number(
    (
      await c.sql<{ q: string }[]>`select coalesce(sum(qty), 0)::text as q
        from contracts.stock_moves where milestone_id = ${m}`
    )[0]?.q,
  );

describe("CR-127 X2 · open-milestones", () => {
  it("liệt kê mốc mở của HĐ còn hiệu lực theo đối tác + SP; HĐ tạm khoá, khác hướng không hiện", async () => {
    const a = await buyWithDelivery();
    const key = (
      await c.sql<
        { k: string }[]
      >`select partner_key as k from contracts.contracts where id = ${a.k}`
    )[0]?.k as string;
    const q = `party_key=${encodeURIComponent(key)}&product_id=${a.p.id}`;
    const r = await call(c, P.hoa, "GET", `/open-milestones?${q}&direction=purchase`);
    expect(r.status).toBe(200);
    const rows = r.json as { obligation_id: string; remaining: string }[];
    expect(rows.map((x) => x.obligation_id)).toEqual([a.m]);
    expect(Number(rows[0]?.remaining)).toBe(10);
    const sale = await call(c, P.hoa, "GET", `/open-milestones?${q}&direction=sale`);
    expect(sale.json).toEqual([]);
    // HĐ đang tạm khoá không hiện để chọn (BR-49).
    await c.sql`update contracts.contracts set exec_hold_at = now(), exec_hold_by = created_by,
      exec_hold_reason = 'kiểm tra' where id = ${a.k}`;
    const held = await call(c, P.hoa, "GET", `/open-milestones?${q}&direction=purchase`);
    expect(held.json).toEqual([]);
  });
});

describe("CR-127 X2 · giao dịch gắn HĐ", () => {
  it("link.obligation_id: ghi THẲNG vào mốc (không tạo chứng từ giao dịch), kho nhập, giao thiếu ⇒ hàng con", async () => {
    const { p, m, partner } = await buyWithDelivery();
    const r = await post(body(partner, p.id, 4, { link: { obligation_id: m }, evidence: ev }));
    expect([r.status, r.json?.state]).toEqual([201, "posted"]);
    expect(r.json?.obligation_id).toBe(m);
    expect(r.json?.child_obligation_id).toBeTruthy();
    expect(await ob(m)).toBe("done");
    expect(await ob(r.json.child_obligation_id)).toBe("open");
    expect(await stockIn(m)).toBe(4);
    expect(await dealRows(partner)).toBe(0);
  });

  it("đối tác còn HĐ chứa SP mà không chọn ⇒ 422 LINK_REQUIRED; Không theo HĐ không lý do ⇒ 422 LINK_REASON_REQUIRED", async () => {
    const { p, partner } = await buyWithDelivery();
    const r1 = await post(body(partner, p.id, 1));
    expect([r1.status, codeOf(r1)]).toEqual([422, "LINK_REQUIRED"]);
    const r2 = await post(body(partner, p.id, 1, { link: { none: { reason: "  " } } }));
    expect([r2.status, codeOf(r2)]).toEqual([422, "LINK_REASON_REQUIRED"]);
    expect(await dealRows(partner)).toBe(0);
  });

  it("Không theo hợp đồng + lý do ⇒ chứng từ giao dịch như cũ, lý do vào nhật ký; đối tác không có HĐ ⇒ tạo thẳng", async () => {
    const { p, partner } = await buyWithDelivery();
    const r = await post(
      body(partner, p.id, 1, { link: { none: { reason: "Hàng mua lẻ ngoài HĐ" } } }),
    );
    expect([r.status, r.json?.state, r.json?.doc_type]).toEqual([201, "posted", "deal"]);
    expect(r.json?.deal_id).toBe(r.json?.id);
    const [e] = await c.sql<
      { reason: string }[]
    >`select data ->> 'reason' as reason from contracts.contract_events
      where contract_id = ${r.json.id} and type = 'deal_unlinked'`;
    expect(e?.reason).toBe("Hàng mua lẻ ngoài HĐ");
    const r2 = await post(body(`Đối tác lạ ${crypto.randomUUID()}`, null, 1));
    expect(r2.status).toBe(201);
  });

  it("giao dịch của đối tác A KHÔNG gắn được vào mốc HĐ của đối tác B ⇒ 404, mốc + kho không đổi", async () => {
    const a = await buyWithDelivery();
    const b = await buyWithDelivery();
    const r = await post(
      body(a.partner, b.p.id, 1, { link: { obligation_id: b.m }, evidence: ev }),
    );
    expect(r.status).toBe(404);
    expect([await ob(b.m), await stockIn(b.m)]).toEqual(["open", 0]);
  });

  it("dòng SP ngoài HĐ ⇒ 422 LINK_MIXED; vượt phần còn lại ⇒ 422 OVER_PLAN; thiếu bằng chứng ⇒ 422 EVIDENCE_REQUIRED", async () => {
    const { p, m, partner } = await buyWithDelivery();
    const other = await product(c.sql, { name: `Khác ${crypto.randomUUID()}`, grp: "goods" });
    const mixed = await post({
      ...body(partner, p.id, 2),
      items: [
        { name: "A", qty: 2, unit_price: 1, product_id: p.id },
        { name: "B", qty: 1, unit_price: 1, product_id: other.id },
      ],
      link: { obligation_id: m },
      evidence: ev,
    });
    expect([mixed.status, codeOf(mixed)]).toEqual([422, "LINK_MIXED"]);
    const over = await post(body(partner, p.id, 11, { link: { obligation_id: m }, evidence: ev }));
    expect([over.status, codeOf(over)]).toEqual([422, "OVER_PLAN"]);
    const noEv = await post(body(partner, p.id, 1, { link: { obligation_id: m } }));
    expect([noEv.status, codeOf(noEv)]).toEqual([422, "EVIDENCE_REQUIRED"]);
    expect(await ob(m)).toBe("open");
    expect(await stockIn(m)).toBe(0);
  });
});

describe("CR-127 X2 · có quy trình transaction.saved: chờ duyệt → duyệt / từ chối", () => {
  const handler = () => {
    const h = flowPortRegistry.outcomeHandlerFor<Tx>("contracts", "transaction.saved");
    if (!h) throw new Error("thiếu OutcomeHandler transaction.saved");
    return h;
  };
  const apply = (ref: string, outcome: string) =>
    c.hub.db.db.transaction((tx) =>
      handler().apply(tx as unknown as Tx, {
        tenantId: T.acme,
        runId: crypto.randomUUID(),
        event: "transaction.saved",
        ref,
        outcome,
        actorId: null,
      }),
    );
  const status = async (id: string) =>
    (
      await c.sql<{ status: string }[]>`select status from contracts.exec_requests where id = ${id}`
    )[0]?.status;
  const withFlow = (on: boolean) =>
    registerFlowEngine(
      on ? ({ runControl: {}, availability: { hasFlowFor: async () => true } } as never) : null,
    );

  it("pending: mốc + kho CHƯA đổi, yêu cầu thứ hai cùng mốc 409; duyệt ⇒ ghi vào mốc (một lần); lặp ⇒ already_applied", async () => {
    const { p, m, partner } = await buyWithDelivery();
    withFlow(true);
    try {
      const r = await post(body(partner, p.id, 4, { link: { obligation_id: m }, evidence: ev }));
      expect([r.status, r.json?.state]).toEqual([202, "pending"]);
      const id = r.json.request_id as string;
      expect([await status(id), await ob(m), await stockIn(m)]).toEqual(["pending", "open", 0]);
      const again = await post(
        body(partner, p.id, 1, { link: { obligation_id: m }, evidence: ev }),
      );
      expect([again.status, codeOf(again)]).toEqual([409, "CHANGE_PENDING"]);
      expect(await apply(id, "approved")).toBe("applied");
      expect([await status(id), await ob(m), await stockIn(m)]).toEqual(["applied", "done", 4]);
      expect(await apply(id, "approved")).toBe("already_applied");
      expect(await stockIn(m)).toBe(4);
    } finally {
      withFlow(false);
    }
  });

  it("từ chối / lượt không mở được ⇒ yêu cầu rejected, mốc + kho không đổi, người tạo được báo", async () => {
    const { p, m, partner } = await buyWithDelivery();
    withFlow(true);
    try {
      const r = await post(body(partner, p.id, 4, { link: { obligation_id: m }, evidence: ev }));
      const id = r.json.request_id as string;
      expect(await apply(id, "rejected")).toBe("applied");
      expect([await status(id), await ob(m), await stockIn(m)]).toEqual(["rejected", "open", 0]);
      const [n] = await c.sql<
        { n: string }[]
      >`select count(*)::text as n from hub.notifications where dedup_key = ${`tx-request:${id}`}`;
      expect(Number(n?.n)).toBe(1);
      const r2 = await post(body(partner, p.id, 4, { link: { obligation_id: m }, evidence: ev }));
      const id2 = r2.json.request_id as string;
      const done = await c.hub.db.db.transaction(
        async (tx) =>
          await handler().notLaunched?.(tx as unknown as Tx, {
            tenantId: T.acme,
            event: "transaction.saved",
            ref: id2,
            reason: "FLOW_NOT_ASSIGNED",
          }),
      );
      expect(done).toBe(true);
      expect([await status(id2), await ob(m)]).toEqual(["rejected", "open"]);
    } finally {
      withFlow(false);
    }
  });
});

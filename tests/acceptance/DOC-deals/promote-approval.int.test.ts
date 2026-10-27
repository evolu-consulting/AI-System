// CR-101 DOC-deals-fix (review cuối đợt) · viết TRƯỚC code:
// (1) nâng giao dịch khi tenant BẬT duyệt ⇒ HĐ về `needs_review` + mở lượt duyệt (không khoá, không lách duyệt); TẮT duyệt ⇒ khoá
//     ngay, `locked_by` = người nâng (không phải người tạo giao dịch).
// (3) nâng chứng từ không phải giao dịch ⇒ 409 TRƯỚC khi đẩy FileBox / trừ hạn mức tải lên.
// (4) tải lên multipart `doc_type=deal` ⇒ 400 rõ ràng (giao dịch đi `/contracts/deals`).
// (6b) xoá V2-M giao dịch ĐÃ HUỶ chuyển từ G1 (dòng kho gốc + dòng đảo cùng `contract_id`) ⇒ kho KHÔNG đảo lần hai (số ròng).
// Hạ tầng V2-D (HD1 + FileBox giả).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { migrateTransactions } from "../../../tools/scripts/src/migrate-transactions-to-contracts";
import { CBASE, pdf, quotaOf, upload } from "../HD1/_support/hd1";
import { restoreApproval, setApproval } from "../V2-A/_support/v2a";
import {
  arrangeV2d,
  type CtxN1,
  call,
  comp,
  d,
  type Json,
  ok,
  P,
  product,
  startHd1,
  stockIn,
  T,
} from "../V2-D/_support/v2d";

let c: CtxN1;
type Person = (typeof P)[keyof typeof P];

beforeAll(async () => {
  c = await startHd1();
  await arrangeV2d(c);
}, 120_000);
afterAll(async () => {
  if (c) await restoreApproval(c.sql);
  await c?.stop();
});

const code = (r: { json: Json }) => r.json?.error?.code ?? null;
const newDeal = async (p: Person = P.hoa) =>
  (
    await ok(
      call(c, p, "POST", "/contracts/deals", {
        deal: "sell",
        source: "verbal",
        title: "Bán dịch vụ",
        partner_name: "Khách X",
        start_date: d(0),
        total_value: 100_000,
        items: [{ name: "Lắp đặt", qty: 1, unit_price: 100_000 }],
      }),
    )
  ).id as string;

async function promote(p: Person, id: string, number = "HĐ-01") {
  const fd = new FormData();
  fd.set("file", new File([pdf() as unknown as BlobPart], "ky.pdf", { type: "application/pdf" }));
  fd.set("number", number);
  const res = await fetch(`${c.hub.base}${CBASE}/${id}/promote`, {
    method: "POST",
    headers: { authorization: `Bearer ${await c.tok(p)}` },
    body: fd,
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : undefined };
}
const rowOf = async (id: string) =>
  (
    await c.sql<{ status: string; locked: boolean; locked_by: string | null; doc_type: string }[]>`
      select status, locked_at is not null as locked, locked_by::text, doc_type from contracts.contracts where id = ${id}`
  )[0];

describe("DOC-deals-fix · nâng thành HĐ theo cờ duyệt", () => {
  it("bật duyệt ⇒ needs_review + lượt duyệt mở, KHÔNG khoá", async () => {
    await setApproval(c.sql, T.acme, true);
    const id = await newDeal();
    const r = await promote(P.lan, id);
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({
      id,
      doc_type: "contract",
      status: "needs_review",
      locked: false,
    });
    expect(await rowOf(id)).toMatchObject({
      status: "needs_review",
      locked: false,
      doc_type: "contract",
    });
    const [a] = await c.sql<{ n: number }[]>`select count(*)::int as n from contracts.approvals
      where contract_id = ${id} and status in ('extracting', 'level1', 'level2')`;
    expect(a?.n).toBe(1);
  });

  it("tắt duyệt ⇒ khoá ngay, locked_by = người nâng", async () => {
    await setApproval(c.sql, T.acme, false);
    const id = await newDeal(P.hoa);
    const r = await promote(P.lan, id);
    expect(r.json).toMatchObject({ status: "active", locked: true });
    expect(await rowOf(id)).toEqual({
      status: "active",
      locked: true,
      locked_by: P.lan.id,
      doc_type: "contract",
    });
  });

  it("không phải giao dịch ⇒ 409 NOT_A_DEAL trước FileBox + hạn mức tải lên", async () => {
    const id = await newDeal();
    await promote(P.lan, id);
    const files = c.fb.ids().length;
    const q = (await quotaOf(c.hub.redis, "t", T.acme)).n;
    expect(code(await promote(P.lan, id))).toBe("NOT_A_DEAL");
    expect(c.fb.ids().length).toBe(files);
    expect((await quotaOf(c.hub.redis, "t", T.acme)).n).toBe(q);
  });

  it("tải lên multipart doc_type=deal ⇒ 400 DEAL_USE_DEALS_ENDPOINT", async () => {
    const r = await upload(c, P.hoa, { fields: { doc_type: "deal" } });
    expect([r.status, code(r)]).toEqual([400, "DEAL_USE_DEALS_ENDPOINT"]);
  });
});

describe("DOC-deals-fix · xoá giao dịch đã huỷ chuyển từ G1", () => {
  it("kho đã đảo ở G1 ⇒ xoá V2-M không đảo lần hai", async () => {
    const p = await product(c.sql, { name: "Keo G1", grp: "goods" });
    const cid = p.comps[0] as string;
    await stockIn(c, p.id, 10, 5_000);
    const id = "d0c0de00-0000-4000-8000-0000000f1101";
    const line = "d0c0de00-0000-4000-8000-0000000f1102";
    await c.sql.begin(async (tx) => {
      await tx`select set_config('contracts.g1_legacy_write', 'on', true)`;
      await tx`insert into contracts.transactions (id, tenant_id, deal, status, occurred_on, partner_name, total, created_by,
          posted_at, posted_by, cancelled_at, cancelled_by, cancel_reason)
        values (${id}, ${T.acme}, 'sell', 'cancelled', ${d(-2)}, 'Khách G1', 5000, ${P.hoa.id}, now(), ${P.hoa.id}, now(),
          ${P.hoa.id}, 'khách huỷ')`;
      await tx`insert into contracts.transaction_lines (id, tenant_id, transaction_id, rev, ord, name, product_id, qty,
          unit_price, amount) values (${line}, ${T.acme}, ${id}, 0, 0, 'Keo G1', ${p.id}, 1, 5000, 5000)`;
    });
    const out = "d0c0de00-0000-4000-8000-0000000f1103";
    await c.sql`insert into contracts.stock_moves (id, tenant_id, component_id, direction, reason, qty, unit_cost, amount,
        moved_on, contract_item_id, transaction_id, reverses)
      values (${out}, ${T.acme}, ${cid}, 'out', 'delivery', 1, 5000, 5000, ${d(-2)}, ${line}, ${id}, null),
        (${"d0c0de00-0000-4000-8000-0000000f1104"}, ${T.acme}, ${cid}, 'in', 'reversal', 1, 5000, 5000, ${d(-1)}, ${line},
          ${id}, ${out})`;
    await migrateTransactions(c.sql, [T.acme], { apply: true });
    expect((await comp(c.sql, cid))?.onHand).toBe(10);
    await ok(call(c, P.lan, "DELETE", `/contracts/${id}`));
    expect((await comp(c.sql, cid))?.onHand).toBe(10);
    const [m] = await c.sql<{ n: number }[]>`select count(*)::int as n from contracts.stock_moves
      where component_id = ${cid} and reason = 'reversal'`;
    expect(m?.n).toBe(1);
  });
});

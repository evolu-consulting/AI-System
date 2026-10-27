// CR-101 DOC-deals · script chuyển Giao dịch G1 → chứng từ (`tools/scripts/src/migrate-transactions-to-contracts.ts`). Viết TRƯỚC code
// (làn đầy đủ: dữ liệu khách thật). (1) chạy thử: số + id đúng, KHÔNG ghi gì; (2) ghi: giữ id, nháp/đã ghi sổ/đã huỷ đúng ánh xạ,
// nghĩa vụ + dòng kho trỏ lại `contract_id`, mốc giao đã xác nhận gắn dòng kho (kho không chạy lại); (3) chạy lại = 0 hàng đổi, số
// hàng mọi bảng không đổi; (4) tenant khác không bị chạm; (5) Câu 7 chỉ báo tập "chắc chắn"/"mơ hồ"; (6) bảng G1 chỉ đọc.
// Hạ tầng HD1 (Postgres thật, vai chủ migration ở `c.sql`; acme + beta). Dữ liệu G1 dựng bằng chủ bảng + cờ `g1_legacy_write`.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { migrateTransactions } from "../../../tools/scripts/src/migrate-transactions-to-contracts";
import { insContract, insFile } from "../HD1/_support/hd1";
import {
  arrangeV2d,
  type CtxN1,
  deal,
  P,
  product,
  type Sql,
  startHd1,
  T,
} from "../V2-D/_support/v2d";

let c: CtxN1;
const id = (n: number) => `d0c0de00-0000-4000-8000-${String(n).padStart(12, "0")}`;
const A1 = id(1); // acme · đã ghi sổ, mua 10 SP (có kho + nghĩa vụ trả)
const A2 = id(2); // acme · nháp, bán dịch vụ
const A3 = id(3); // acme · đã huỷ (kho đã đảo, nghĩa vụ huỷ)
const A4 = id(4); // acme · nháp không rõ người tạo ⇒ không chuyển
const B1 = id(5); // beta · đã ghi sổ
const L1 = id(11);
let comp = "";

async function legacy(sql: Sql, f: (tx: Sql) => Promise<unknown>): Promise<void> {
  await sql.begin(async (tx) => {
    await tx`select set_config('contracts.g1_legacy_write', 'on', true)`;
    await f(tx as unknown as Sql);
  });
}

async function seed(sql: Sql): Promise<void> {
  const p = await product(sql, { name: "Băng keo", grp: "goods" });
  comp = p.comps[0] as string;
  const u = P.hoa.id;
  await legacy(sql, async (tx) => {
    await tx`insert into contracts.transactions (id, tenant_id, deal, status, occurred_on, due_on, partner_name,
        partner_tax_id, total, created_by, posted_at, posted_by, cancelled_at, cancelled_by, cancel_reason, note, product_group)
      values
      (${A1}, ${T.acme}, 'buy', 'posted', '2026-10-01', '2026-10-15', 'Công ty A', '0100684378', 50000, ${u}, now(), ${u},
        null, null, null, 'ghi chú A1', 'goods'),
      (${A2}, ${T.acme}, 'sell', 'draft', '2026-10-02', null, 'Khách B', null, 200000, ${u}, null, null, null, null, null,
        null, 'service'),
      (${A3}, ${T.acme}, 'sell', 'cancelled', '2026-10-03', null, 'Khách C', null, 30000, ${u}, now(), ${u}, now(), ${u},
        'khách huỷ', null, null),
      (${A4}, ${T.acme}, 'sell', 'draft', '2026-10-04', null, 'Khách D', null, 0, null, null, null, null, null, null, null, null),
      (${B1}, ${T.beta}, 'sell', 'posted', '2026-10-05', null, 'Khách E', null, 10000, ${P.an.id}, now(), ${P.an.id},
        null, null, null, null, null)`;
    await tx`insert into contracts.transaction_lines (id, tenant_id, transaction_id, rev, ord, name, product_id, qty,
        unit_price, amount)
      values (${L1}, ${T.acme}, ${A1}, 0, 0, 'Băng keo', ${p.id}, 10, 5000, 50000),
        (${id(12)}, ${T.acme}, ${A2}, 0, 0, 'Dịch vụ lắp', null, 1, 200000, 200000),
        (${id(13)}, ${T.acme}, ${A3}, 0, 0, 'Dịch vụ', null, 1, 30000, 30000),
        (${id(14)}, ${T.beta}, ${B1}, 0, 0, 'Dịch vụ', null, 1, 10000, 10000)`;
  });
  await sql`insert into contracts.obligations (tenant_id, transaction_id, party_key, direction, kind, seq, due_date, amount,
      status, source, cancel_reason)
    values (${T.acme}, ${A1}, 'tax:0100684378', 'pay', 'payment', 1, '2026-10-15', 50000, 'open', 'manual', null),
      (${T.acme}, ${A3}, 'name:khach c', 'receive', 'payment', 1, '2026-10-03', 30000, 'cancelled', 'manual', 'khách huỷ'),
      (${T.beta}, ${B1}, 'name:khach e', 'receive', 'payment', 1, '2026-10-05', 10000, 'open', 'manual', null)`;
  const mv = (n: number) => id(100 + n);
  await sql`insert into contracts.stock_moves (id, tenant_id, component_id, direction, reason, qty, unit_cost, amount, moved_on,
      contract_item_id, transaction_id, reverses)
    values (${mv(1)}, ${T.acme}, ${comp}, 'in', 'delivery', 10, 5000, 50000, '2026-10-01', ${L1}, ${A1}, null),
      (${mv(2)}, ${T.acme}, ${comp}, 'out', 'delivery', 1, 5000, 5000, '2026-10-03', ${id(13)}, ${A3}, null),
      (${mv(3)}, ${T.acme}, ${comp}, 'in', 'reversal', 1, 5000, 5000, '2026-10-04', ${id(13)}, ${A3}, ${mv(2)})`;
}

const fv = (value: unknown) => ({ value, quote: "", verified: true, edited: true });
const M = { sure: id(201), noEvent: id(202), withText: id(203), withFile: id(204) };

/** Câu 7: HĐ "nhập tay" theo nhiều nguồn dấu vết. */
async function seedManual(sql: Sql): Promise<void> {
  for (const [k, v] of Object.entries(M))
    await insContract(sql, {
      id: v,
      tenant: T.acme,
      direction: "sale",
      fields: { buyer_name: fv(`Khách ${k}`) },
      source: k === "withText" ? "nội dung HĐ đã đọc" : null,
    });
  await insFile(sql, T.acme, id(300), "fb-1");
  await sql`update contracts.contracts set file_id = ${id(300)} where id = ${M.withFile}`;
  await sql`insert into contracts.contract_events (tenant_id, contract_id, type, data)
    select ${T.acme}::uuid, x, 'created_manual', '{}'::jsonb from unnest(${[M.sure, M.withText, M.withFile]}::uuid[]) x`;
}

const TABLES = [
  "contracts",
  "contract_items",
  "obligations",
  "stock_moves",
  "milestone_items",
  "contract_events",
  "transactions",
  "transaction_lines",
] as const;
async function counts(sql: Sql): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const t of TABLES)
    out[t] = Number((await sql.unsafe(`select count(*)::int as n from contracts.${t}`))[0]?.n);
  return out;
}

beforeAll(async () => {
  c = await startHd1();
  await arrangeV2d(c);
  await c.sql`truncate contracts.transactions, contracts.transaction_lines, contracts.transaction_events,
    contracts.contract_edit_log`;
  await seed(c.sql);
  await seedManual(c.sql);
  await deal(c.sql, { tenant: T.beta }); // beta có HĐ riêng (không bị chạm)
}, 120_000);
afterAll(async () => {
  await c?.stop();
});

describe("DOC-deals · script chuyển G1 → chứng từ", () => {
  it("chạy thử (mặc định): số + id đúng, Câu 7 phân loại theo nguồn thật, KHÔNG ghi", async () => {
    const before = await counts(c.sql);
    const r = await migrateTransactions(c.sql, [T.acme], { apply: false });
    expect(r.applied).toBeNull();
    expect(r.plan).toMatchObject({
      transactions: 3,
      byStatus: { draft: 1, posted: 1, cancelled: 1 },
      ids: [A1, A2, A3],
      lines: 3,
      obligations: 2,
      stockMoves: 3,
      milestones: 3,
      conflicts: [],
      noCreator: [A4],
    });
    expect(r.manual.sure).toEqual([M.sure]);
    expect(r.manual.ambiguous).toEqual([
      { id: M.noEvent, why: ["no_manual_event"] },
      { id: M.withText, why: ["source_text"] },
    ]);
    expect(r.lines[0]).toContain("CHẠY THỬ");
    expect(await counts(c.sql)).toEqual(before);
  });

  it("ghi: giữ id, ánh xạ trạng thái, nghĩa vụ + kho trỏ lại, mốc giao đã xác nhận; tenant khác không chạm", async () => {
    const r = await migrateTransactions(c.sql, [T.acme], { apply: true });
    expect(r.applied).toMatchObject({
      contracts: 3,
      items: 3,
      obligations: 2,
      stockMoves: 3,
      milestones: 3,
      milestoneLinks: 1,
      milestoneItems: 1,
      events: 3,
    });
    const docs = await c.sql<
      {
        id: string;
        doc_type: string;
        source: string;
        status: string;
        deal: string;
        locked: boolean;
        value: number;
      }[]
    >`select id::text, doc_type, source, status, deal, locked_at is not null as locked, value::int as value
      from contracts.contracts where id = any(${[A1, A2, A3, A4, B1]}::uuid[]) order by id`;
    expect([...docs]).toEqual([
      {
        id: A1,
        doc_type: "deal",
        source: "other",
        status: "active",
        deal: "buy",
        locked: false,
        value: 50000,
      },
      {
        id: A2,
        doc_type: "deal",
        source: "other",
        status: "active",
        deal: "sell",
        locked: false,
        value: 200000,
      },
      {
        id: A3,
        doc_type: "deal",
        source: "other",
        status: "rejected",
        deal: "sell",
        locked: false,
        value: 30000,
      },
    ]);
    // Đã ghi sổ: nghĩa vụ trả cũ (mốc tiền) + mốc giao ĐÃ XÁC NHẬN gắn dòng kho; kho không chạy lại.
    const obl = await c.sql<
      { kind: string; direction: string; status: string; tx: string | null }[]
    >`
      select kind, direction, status, transaction_id::text as tx from contracts.obligations
      where contract_id = ${A1} order by seq`;
    expect([...obl]).toEqual([
      { kind: "payment", direction: "pay", status: "open", tx: A1 },
      { kind: "delivery", direction: "pay", status: "done", tx: null },
    ]);
    const mv = await c.sql<{ contract_id: string; ms: boolean; item: string }[]>`
      select contract_id::text, milestone_id is not null as ms, contract_item_id::text as item
      from contracts.stock_moves where transaction_id = ${A1}`;
    expect([...mv]).toEqual([{ contract_id: A1, ms: true, item: L1 }]);
    const items = await c.sql<
      { id: string; qty: string }[]
    >`select id::text, trim_scale(qty)::text as qty
      from contracts.contract_items where contract_id = ${A1}`;
    expect([...items]).toEqual([{ id: L1, qty: "10" }]);
    const [mi] = await c.sql<
      { d: string }[]
    >`select trim_scale(delivered)::text as d from contracts.milestone_items
      where contract_id = ${A1}`;
    expect(mi?.d).toBe("10");
    // Nháp: mốc giao + thu tiền MỞ.
    const draft = await c.sql<{ kind: string; direction: string; status: string }[]>`
      select kind, direction, status from contracts.obligations where contract_id = ${A2} order by seq`;
    expect([...draft]).toEqual([
      { kind: "delivery", direction: "receive", status: "open" },
      { kind: "payment", direction: "receive", status: "open" },
    ]);
    // Huỷ: nghĩa vụ huỷ + kho đảo giữ, trỏ lại chứng từ; không tạo mốc.
    const [x] = await c.sql<{ n: number; moves: number }[]>`select
      (select count(*)::int from contracts.obligations where contract_id = ${A3}) as n,
      (select count(*)::int from contracts.stock_moves where contract_id = ${A3}) as moves`;
    expect(x).toEqual({ n: 1, moves: 2 });
    const [ev] = await c.sql<
      { data: { note?: string; status?: string } }[]
    >`select data from contracts.contract_events
      where contract_id = ${A1} and type = 'migrated_from_transaction'`;
    expect(ev?.data).toMatchObject({ note: "ghi chú A1", status: "posted" });
    // Tenant khác: B1 chưa chuyển, nghĩa vụ beta vẫn chỉ trỏ giao dịch.
    const [b] = await c.sql<{ n: number; o: number }[]>`select
      (select count(*)::int from contracts.contracts where id = ${B1}) as n,
      (select count(*)::int from contracts.obligations where transaction_id = ${B1} and contract_id is null) as o`;
    expect(b).toEqual({ n: 0, o: 1 });
  });

  it("chạy lại: 0 hàng đổi, số hàng mọi bảng giữ nguyên", async () => {
    const before = await counts(c.sql);
    const r = await migrateTransactions(c.sql, [T.acme], { apply: true });
    expect(r.applied).toEqual({
      contracts: 0,
      items: 0,
      obligations: 0,
      stockMoves: 0,
      milestones: 0,
      milestoneLinks: 0,
      milestoneItems: 0,
      events: 0,
    });
    expect(r.plan.transactions).toBe(0);
    expect(await counts(c.sql)).toEqual(before);
    // Câu 7 KHÔNG ghi: HĐ nhập tay "chắc chắn" vẫn là HĐ kinh tế.
    const [m] = await c.sql<
      { t: string }[]
    >`select doc_type as t from contracts.contracts where id = ${M.sure}`;
    expect(m?.t).toBe("contract");
  });

  it("bảng G1 chỉ đọc: app (contracts_rw) không có quyền ghi; chủ bảng không cờ ⇒ EG410", async () => {
    const err = await c.sql`update contracts.transactions set note = 'x' where id = ${A1}`.catch(
      (e) => e,
    );
    expect(err?.code).toBe("EG410");
    const rw = await c.sql
      .begin(async (tx) => {
        await tx`set local role contracts_rw`;
        await tx`select set_config('app.tenant_id', ${T.acme}, true)`;
        await tx`delete from contracts.transaction_events where tenant_id = ${T.acme}`;
      })
      .catch((e) => e);
    expect(rw?.code).toBe("42501");
  });
});

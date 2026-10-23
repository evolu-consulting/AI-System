// atomic-confirm (người dùng 2026-10-24) · HD-FR-100 · products-confirm: tenant TẮT duyệt — "Xác nhận và lưu" = MỘT `POST /review`
// mang `products` (cùng schema `products` của approve). Gắn/tạo SP + xác nhận + khoá trong MỘT tx; lỗi gắn SP ⇒ ROLLBACK cả lệnh
// (HĐ giữ needs_review, chưa khoá, không SP). Viết TRƯỚC code (làn đầy đủ: khoá + dữ liệu khách). Hạ tầng HD3 (hub-api THẬT).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { insContract, insItem } from "../HD1/_support/hd1";
import { CBASE, type CtxHd3, cid, errCode, startHd3, T } from "../HD3/_hd3";
import { PA } from "../P-d/_support/pd";

let c: CtxHd3;
let had: boolean | null = null;
beforeAll(async () => {
  c = await startHd3();
  const [h] = await c.sql<{ v: boolean | null }[]>`select approval_enabled as v
    from contracts.approval_settings where tenant_id = ${T.acme}`;
  had = h?.v ?? null;
  await c.sql`insert into contracts.approval_settings (tenant_id, approval_enabled) values (${T.acme}, false)
    on conflict (tenant_id) do update set approval_enabled = false`;
}, 180_000);
afterAll(async () => {
  if (!c) return;
  await c.sql`update contracts.approval_settings set approval_enabled = ${had}
    where tenant_id = ${T.acme}`;
  await c.stop();
});

type Row = { status: string; locked_at: Date | null };
const row = async (id: string): Promise<Row> =>
  (
    await c.sql<Row[]>`select status, locked_at from contracts.contracts where id = ${id}`
  )[0] as Row;
const itemPids = async (id: string) =>
  (
    await c.sql<{ id: string; pid: string | null }[]>`select id::text as id, product_id::text as pid
      from contracts.contract_items where contract_id = ${id} order by ord`
  ).map((r) => ({ id: r.id, pid: r.pid }));
const productsFrom = async (id: string) =>
  (
    await c.sql<{ n: number }[]>`select count(*)::int as n from contracts.products
      where created_from_contract_id = ${id}`
  )[0]?.n;

/** HĐ acme chờ xác nhận + 2 dòng chưa có SP. */
async function seed(n: number): Promise<{ id: string; i1: string; i2: string }> {
  const id = cid(n);
  await insContract(c.sql, {
    id,
    tenant: T.acme,
    status: "needs_review",
    createdBy: PA.B.id,
    owner: PA.B.id,
  } as never);
  const i1 = `e2000000-0000-4000-8000-00000000${n}1`;
  const i2 = `e2000000-0000-4000-8000-00000000${n}2`;
  await insItem(c.sql, T.acme, id, 1, { id: i1, name: `Thùng carton AC-${n}` });
  await insItem(c.sql, T.acme, id, 2, { id: i2, name: `Băng keo AC-${n}` });
  return { id, i1, i2 };
}

describe("atomic-confirm · tắt duyệt: xác nhận + gắn SP trong MỘT lệnh", () => {
  it("POST /review kèm products ⇒ 200 active, khoá, dòng đã gắn SP (mới + có sẵn), SP mới tạo từ HĐ", async () => {
    const { id, i1, i2 } = await seed(401);
    const [ex] = await c.sql<
      { id: string }[]
    >`insert into contracts.products (tenant_id, name, unit, grp)
      values (${T.acme}, 'Băng keo có sẵn AC-401', 'cuộn', 'goods') returning id::text as id`;
    const r = await c.call("B", "POST", `${CBASE}/${id}/review`, {
      version: 1,
      products: [
        {
          item_id: i1,
          new_product: { name: "Thùng carton AC-401", unit: "thùng", group: "goods" },
        },
        { item_id: i2, product_id: ex?.id },
      ],
    });
    expect({ status: r.status, s: r.json?.status }).toEqual({ status: 200, s: "active" });
    const k = await row(id);
    expect({ s: k.status, locked: k.locked_at !== null }).toEqual({ s: "active", locked: true });
    const pids = await itemPids(id);
    expect(pids.every((p) => p.pid !== null)).toBe(true);
    expect(pids.find((p) => p.id === i2)?.pid).toBe(ex?.id);
    expect(await productsFrom(id)).toBe(1);
    const ev = await c.sql<{ n: number }[]>`select count(*)::int as n from contracts.contract_events
      where contract_id = ${id} and type = 'item_product_set'`;
    expect(ev[0]?.n).toBe(2);
  }, 60_000);

  it("mapping sai (SP của tenant khác) ⇒ 422, HĐ vẫn needs_review, chưa khoá, không SP", async () => {
    const { id, i1, i2 } = await seed(402);
    const [beta] = await c.sql<
      { id: string }[]
    >`insert into contracts.products (tenant_id, name, unit, grp)
      values (${T.beta}, 'SP beta AC-402', 'cái', 'goods') returning id::text as id`;
    const r = await c.call("B", "POST", `${CBASE}/${id}/review`, {
      version: 1,
      products: [
        {
          item_id: i1,
          new_product: { name: "Thùng carton AC-402", unit: "thùng", group: "goods" },
        },
        { item_id: i2, product_id: beta?.id },
      ],
    });
    expect({ status: r.status, code: errCode(r) }).toEqual({
      status: 422,
      code: "PRODUCT_INVALID",
    });
    expect(await row(id)).toEqual({ status: "needs_review", locked_at: null });
    expect((await itemPids(id)).every((p) => p.pid === null)).toBe(true);
    expect(await productsFrom(id)).toBe(0);
  }, 60_000);

  it("mapping sai (dòng không thuộc HĐ) ⇒ 422, HĐ vẫn needs_review, chưa khoá, không SP", async () => {
    const { id, i1 } = await seed(403);
    const r = await c.call("B", "POST", `${CBASE}/${id}/review`, {
      version: 1,
      products: [
        {
          item_id: i1,
          new_product: { name: "Thùng carton AC-403", unit: "thùng", group: "goods" },
        },
        {
          item_id: "e2000000-0000-4000-8000-0000000fffff",
          new_product: { name: "Lạ AC-403", unit: "cái", group: "goods" },
        },
      ],
    });
    expect(r.status).toBe(422);
    expect(await row(id)).toEqual({ status: "needs_review", locked_at: null });
    expect((await itemPids(id)).every((p) => p.pid === null)).toBe(true);
    expect(await productsFrom(id)).toBe(0);
  }, 60_000);

  it("draft kèm products ⇒ 400 (products chỉ cho lệnh xác nhận)", async () => {
    const { id, i1 } = await seed(404);
    const r = await c.call("B", "POST", `${CBASE}/${id}/review`, {
      version: 1,
      draft: true,
      products: [
        {
          item_id: i1,
          new_product: { name: "Thùng carton AC-404", unit: "thùng", group: "goods" },
        },
      ],
    });
    expect(r.status).toBe(400);
    expect(await row(id)).toEqual({ status: "needs_review", locked_at: null });
  }, 60_000);

  it("sau khi khoá: product-links (gắn lần đầu) ⇒ 409 CONTRACT_LOCKED", async () => {
    const { id, i1 } = await seed(405);
    const k = await c.call("B", "POST", `${CBASE}/${id}/review`, { version: 1 });
    expect(k.json?.status).toBe("active");
    const r = await c.call("B", "POST", `${CBASE}/${id}/product-links`, {
      links: [
        {
          item_id: i1,
          new_product: { name: "Thùng carton AC-405", unit: "thùng", group: "goods" },
        },
      ],
    });
    expect({ status: r.status, code: errCode(r) }).toEqual({
      status: 409,
      code: "CONTRACT_LOCKED",
    });
    expect(await productsFrom(id)).toBe(0);
  }, 60_000);
});

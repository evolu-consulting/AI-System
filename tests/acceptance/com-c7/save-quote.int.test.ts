// com-c7 · CR-102b · ADR-0031 · R18–R25 qua DB THẬT (RLS gói, pool hub_api): cổng `SupplierQuoteWriter` (saveQuoteUsecase) — đường
// chính (giá nguồn Báo giá + VAT/hạn/origin_ref + vai NCC MỚI; không đổi kho/giá vốn), thay giá cùng NCC (cũ vào lịch sử, cảnh báo lệch
// > 30%), gỡ mềm qua route cũ, chặn user ngoài, chặn chéo tenant trên cột/policy UPDATE mới. Tab NCC & giá đọc qua hub thật.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createDb, type Db } from "@ai/db";
import { urls } from "@ai/test-kit/env";
import { productsRepo } from "../../../apps/hub-api/src/modules/packs/contracts/adapters/products.repo";
import { supplierQuoteRepo } from "../../../apps/hub-api/src/modules/packs/contracts/adapters/supplier-quote.repo";
import {
  SaveQuoteFail,
  saveQuoteUsecase,
} from "../../../apps/hub-api/src/modules/packs/contracts/application/save-quote.usecase";
import type { QuoteInput } from "../../../apps/hub-api/src/modules/packs/contracts/application/supplier-quote.ports";
import { partyKey } from "../../../apps/hub-api/src/modules/packs/contracts/domain/ledger.rules";
import { createPackUow } from "../../../apps/hub-api/src/modules/packs/kit/adapters/pack-uow";
import { BASE, type CtxJ2, type Json, P, seedProduct, startJ2, T } from "../V2-J2/_support/v2j2";

let c: CtxJ2;
let db: Db;
let pid: string;
const NOW = new Date("2026-10-28T03:00:00Z");
const NCC = "NCC C7 Minh Phát";
const KEY = partyKey(NCC, null) as string;

beforeAll(async () => {
  c = await startJ2();
  db = createDb(urls().hubApi, { max: 2 });
  await c.sql`truncate contracts.products cascade`;
  await c.sql`delete from contracts.partner_roles where party_key = ${KEY}`;
  pid = await seedProduct(c, {
    tenant: T.acme,
    name: "Băng keo C7",
    avgCost: 100_000,
    supplier: { key: "tax:0100684378", unitCost: 100_000, qty: 10 },
  });
}, 120_000);
afterAll(async () => {
  await db?.close();
  await c?.stop();
});

const uow = createPackUow;
const writer = () =>
  saveQuoteUsecase({
    uow: uow(db, "contracts", (tx, t) => ({
      quotes: supplierQuoteRepo(tx, t),
      products: productsRepo(tx, t),
    })),
    canWrite: async () => true,
    timeZoneOf: async () => "Asia/Ho_Chi_Minh",
    now: () => NOW,
  });
const hoa = { tenantId: T.acme, userId: P.hoa.id, kind: "internal" as const };
const quote = (o: Partial<QuoteInput> = {}): QuoteInput =>
  ({
    product_id: pid,
    supplier: { name: NCC },
    price: 100_000,
    unit: "cái",
    vat_included: true,
    kind: "new",
    quoted_at: "2026-10-28",
    expires_on: "2026-12-31",
    origin_ref: { pack: "community", post_id: "post-1", item_idx: 0 },
    ...o,
  }) as QuoteInput;
const stock = async () =>
  (
    await c.sql<
      Json[]
    >`select (select avg_cost::text from contracts.product_components where product_id = ${pid}) as avg,
      (select on_hand::text from contracts.product_components where product_id = ${pid}) as on_hand,
      (select count(*)::int from contracts.stock_moves m join contracts.product_components pc on pc.id = m.component_id
        where pc.product_id = ${pid}) as moves`
  )[0];
const prices = () =>
  c.sql<Json[]>`select id::text, price::int, source, vat_included, expires_on::text, origin_ref,
      replaced_at is not null as replaced, removed_at is not null as removed
    from contracts.product_supplier_prices where product_id = ${pid} order by created_at`;
const call = (p: (typeof P)[keyof typeof P], m: string, path: string) =>
  c.hubCall(p, m, `${BASE}${path}`);

describe("com-c7 · Lưu báo giá (SupplierQuoteWriter)", () => {
  let first = "";

  it("đường chính: giá Báo giá + VAT/hạn/origin_ref, vai NCC MỚI, giá đầu tiên; kho/giá vốn giữ nguyên (R25)", async () => {
    const before = await stock();
    const out = await writer().save(hoa, quote());
    expect(out).toMatchObject({
      compare: { kind: "first" },
      warnings: [],
      replaces: [],
      product_id: pid,
      product_created: false,
      supplier_party_key: KEY,
      supplier_created: true,
    });
    first = out.price_id;
    expect([...(await prices())]).toEqual([
      {
        id: first,
        price: 100_000,
        source: "quote",
        vat_included: true,
        expires_on: "2026-12-31",
        origin_ref: { pack: "community", post_id: "post-1", item_idx: 0 },
        replaced: false,
        removed: false,
      },
    ]);
    const roles = await c.sql<Json[]>`select role, created_from from contracts.partner_roles
      where tenant_id = ${T.acme} and party_key = ${KEY}`;
    expect([...roles]).toEqual([{ role: "supplier", created_from: "manual" }]);
    expect(await stock()).toEqual(before);
  });

  it("cùng NCC + SP lưu lại ⇒ thay giá cũ (lịch sử), cảnh báo lệch > 30%; tab NCC & giá: mới ở bảng, cũ 'Đã thay'", async () => {
    const pv = await writer().preview(hoa, quote({ price: 140_000 }));
    expect(pv).toEqual({
      compare: { kind: "dearer", ref_price: 100_000, ref_supplier: NCC, diff: 40_000, pct: 40 },
      warnings: [{ code: "deviation", pct: 40, ref_price: 100_000 }],
      replaces: [first],
    });
    const out = await writer().save(hoa, quote({ price: 140_000 }));
    expect(out).toMatchObject({ ...pv, supplier_created: false });
    const rows = await prices();
    expect(rows.map((r) => [r.price, r.replaced])).toEqual([
      [100_000, true],
      [140_000, false],
    ]);
    const ov: Json = (await call(P.tam, "GET", `/products/${pid}/suppliers`)).json;
    expect(
      ov.rows.filter((r: Json) => r.source === "quote").map((r: Json) => [r.price, r.vat_included]),
    ).toEqual([[140_000, true]]);
    expect(ov.history.map((r: Json) => [r.id, r.status])).toEqual([[first, "replaced"]]);
  });

  it("gỡ qua route cũ = gỡ MỀM (R21): dòng còn trong DB, sang lịch sử 'Đã gỡ'", async () => {
    const live = (await prices()).find((r) => !r.replaced)?.id as string;
    expect((await call(P.hoa, "DELETE", `/products/${pid}/supplier-prices/${live}`)).status).toBe(
      204,
    );
    expect((await prices()).map((r) => r.removed)).toEqual([false, true]);
    const ov: Json = (await call(P.tam, "GET", `/products/${pid}/suppliers`)).json;
    expect(ov.rows.some((r: Json) => r.source === "quote")).toBe(false);
    expect(ov.history.find((r: Json) => r.id === live)?.status).toBe("removed");
  });

  it("user ngoài (kind=external) ⇒ forbidden, không ghi gì (ADR-0031 §4)", async () => {
    const n = (await prices()).length;
    const ext = { ...hoa, kind: "external" as const };
    await expect(writer().save(ext, quote())).rejects.toBeInstanceOf(SaveQuoteFail);
    await expect(writer().preview(ext, quote())).rejects.toMatchObject({ kind: "forbidden" });
    expect((await prices()).length).toBe(n);
  });

  it("chéo tenant: tenant khác không lưu vào SP, không thay/gỡ được dòng của tenant này (policy UPDATE mới)", async () => {
    const snap = await prices();
    const an = { tenantId: P.an.tid, userId: P.an.id, kind: "internal" as const };
    await expect(writer().save(an, quote())).rejects.toMatchObject({ kind: "not_found" });
    // phiên `contracts_rw` của tenant khác (như withPackScope): RLS tenant chặn cả đọc lẫn UPDATE hai cột mốc mới
    const n = await c.sql.begin(async (tx) => {
      await tx`select set_config('app.tenant_id', ${P.an.tid}, true), set_config('app.user_id', ${P.an.id}, true)`;
      await tx.unsafe("set local role contracts_rw");
      const r = await tx`update contracts.product_supplier_prices
        set replaced_at = now(), removed_at = now() where product_id = ${pid} returning id`;
      const s =
        await tx`select id from contracts.product_supplier_prices where product_id = ${pid}`;
      return r.length + s.length;
    });
    expect(n).toBe(0);
    expect([...(await prices())]).toEqual([...snap]);
  });

  it("SP mới tạo cùng lúc (tên + đơn vị + nhóm) ⇒ SP + giá trong một tx", async () => {
    const out = await writer().save(
      hoa,
      quote({
        product_id: undefined,
        new_product: { name: "Thùng carton C7", unit: "thùng", group: "goods" },
      } as never),
    );
    expect(out).toMatchObject({ product_created: true, compare: { kind: "first" } });
    const [p] = await c.sql<
      Json[]
    >`select p.name, p.unit, (select count(*)::int from contracts.product_supplier_prices s
        where s.product_id = p.id and s.source = 'quote') as n from contracts.products p where p.id = ${out.product_id}`;
    expect(p).toEqual({ name: "Thùng carton C7", unit: "thùng", n: 1 });
  });
});

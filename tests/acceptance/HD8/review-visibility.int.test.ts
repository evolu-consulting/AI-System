// HD8 · review HD78 #1 + #2 (làn đầy đủ, test viết TRƯỚC code): M1 trên bảng HD8 — danh bạ công ty, báo giá, ảnh chụp điểm chỉ
// thấy/sửa/xoá theo đối tác người dùng thấy (`visible_party_keys()`) hoặc do mình tạo; xoá báo giá cần `admin`; và khoá/tham số có
// NUL ⇒ 400 (không 500). Kiểm cả qua HTTP lẫn trực tiếp dưới role gói (`withPackScope`) để không lọt nếu route quên lọc.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { withPackScope } from "@ai/db/pack-scope";
import { connectDb } from "../../../apps/hub-api/src/lib/db";
import { HUB_API_URL } from "../H1/_fixtures";
import {
  arrangeHd8,
  type CtxN1,
  call,
  deal,
  items,
  type Json,
  ok,
  P,
  startHd1,
  T,
} from "./_support/hd8";

let c: CtxN1;
let db: ReturnType<typeof connectDb>;
beforeAll(async () => {
  c = await startHd1();
  db = connectDb(HUB_API_URL, 2);
}, 120_000);
afterAll(async () => {
  await db?.close();
  await c?.stop();
});

const PORK = "name:thit heo|";
const LAN_ONLY = "tax:0311110001";
const SHARED = "tax:0311110002";
const enc = encodeURIComponent;

/** HĐ mua thịt heo: của Lan (Hoà không thấy ở chế độ org) và của Hoà; danh bạ + báo giá + ảnh chụp cho cả hai; rồi bật org. */
async function twoSuppliers() {
  await arrangeHd8(c);
  const lanDeal = await deal(c.sql, { sale: false, partner: "NCC Riêng Lan", tax: "0311110001" });
  const hoaDeal = await deal(c.sql, { sale: false, partner: "NCC Của Hoà", tax: "0311110002" });
  await c.sql`update contracts.contracts set owner_user_id = ${P.hoa.id} where id = ${hoaDeal}`;
  for (const [id, price] of [
    [lanDeal, 98_000],
    [hoaDeal, 99_000],
  ] as const)
    await items(c.sql, T.acme, id, [{ name: "Thịt heo", unit: "kg", unit_price: price }]);
  for (const [tax, name] of [
    ["0311110001", "NCC Riêng Lan"],
    ["0311110002", "NCC Của Hoà"],
  ])
    await ok(call(c, P.lan, "POST", "/companies", { tax_id: tax, name }));
  const q = await ok(
    call(c, P.lan, "POST", "/prices/quotes", {
      product: PORK,
      supplier_name: "NCC Riêng Lan",
      supplier_tax_id: "0311110001",
      price: 97_000,
      quoted_at: "2026-10-10",
    }),
  );
  for (const party of [LAN_ONLY, SHARED])
    await c.sql`insert into contracts.score_snapshots (tenant_id, party_key, role, config_version, score, band)
      values (${T.acme}, ${party}, 'supplier', 1, 80, 'good')`;
  await ok(call(c, P.lan, "PUT", "/visibility", { mode: "org" }));
  return { quoteId: q.id as string };
}

const asHoa = <R>(fn: Parameters<typeof withPackScope<R>>[2]) =>
  withPackScope(db, { packKey: "contracts", tenantId: T.acme, userId: P.hoa.id }, fn);
const rows = async (q: string) =>
  asHoa(async (tx) => (await tx.execute(q as never)) as unknown as Record<string, unknown>[]);

describe("HD8 review #2 · M1 trên danh bạ, báo giá, ảnh chụp điểm (chế độ org)", () => {
  it("thành viên chỉ thấy/sửa công ty của đối tác mình thấy hoặc do mình tạo; ngoài phạm vi ⇒ 404", async () => {
    await twoSuppliers();
    try {
      const list: Json[] = await ok(call(c, P.hoa, "GET", "/companies"));
      expect(list.map((x: Json) => x.party)).toEqual([SHARED]);
      const put = await call(c, P.hoa, "PUT", `/companies?party=${enc(LAN_ONLY)}`, {
        short_name: "Đổi trộm",
      });
      expect(put.status).toBe(404);
      const ref = await call(c, P.hoa, "POST", `/companies/refresh?party=${enc(LAN_ONLY)}`);
      expect(ref.status).toBe(404);
      const [kept] = await c.sql<
        { short_name: string | null }[]
      >`select short_name from contracts.companies
        where party_key = ${LAN_ONLY}`;
      expect(kept?.short_name ?? null).toBeNull();
      // công ty do chính mình tạo vẫn thấy dù chưa có HĐ
      await ok(call(c, P.hoa, "POST", "/companies", { name: "Công ty Hoà tự thêm" }));
      const after: Json[] = await ok(call(c, P.hoa, "GET", "/companies"));
      expect(after.map((x: Json) => x.party).sort()).toEqual(
        [SHARED, "name:cong ty hoa tu them"].sort(),
      );
      // trực tiếp dưới role gói: không đọc, không sửa được hàng ngoài phạm vi
      expect((await rows("select party_key from contracts.companies order by 1")).length).toBe(2);
      const upd = await rows(
        `update contracts.companies set short_name = 'x' where party_key = '${LAN_ONLY}' returning id`,
      );
      expect(upd.length).toBe(0);
      // owner vẫn thấy hết
      const all: Json[] = await ok(call(c, P.lan, "GET", "/companies"));
      expect(all.length).toBe(3);
    } finally {
      await c.sql`update contracts.visibility_settings set mode = 'tenant'`;
    }
  });

  it("báo giá của NCC ngoài phạm vi không lộ khi so giá; xoá báo giá cần quản lý; role gói không đọc/xoá được", async () => {
    const { quoteId } = await twoSuppliers();
    try {
      const cmp = await ok(call(c, P.hoa, "GET", `/prices/compare?product=${enc(PORK)}`));
      expect(cmp.rows.map((r: Json) => r.supplier)).toEqual(["NCC Của Hoà"]);
      expect((await call(c, P.hoa, "DELETE", `/prices/quotes/${quoteId}`)).status).toBe(403);
      expect((await rows("select id from contracts.price_quotes")).length).toBe(0);
      expect(
        (await rows(`delete from contracts.price_quotes where id = '${quoteId}' returning id`))
          .length,
      ).toBe(0);
      const snaps = await rows("select party_key from contracts.score_snapshots");
      expect(snaps.map((s) => s.party_key)).toEqual([SHARED]);
      // báo giá do chính Hoà thêm (NCC mình thấy) vẫn thấy
      await ok(
        call(c, P.hoa, "POST", "/prices/quotes", {
          product: PORK,
          supplier_name: "NCC Của Hoà",
          supplier_tax_id: "0311110002",
          price: 96_000,
          quoted_at: "2026-10-11",
        }),
      );
      expect((await rows("select id from contracts.price_quotes")).length).toBe(1);
      // quản lý (owner) xoá được
      expect((await call(c, P.lan, "DELETE", `/prices/quotes/${quoteId}`)).status).toBe(200);
    } finally {
      await c.sql`update contracts.visibility_settings set mode = 'tenant'`;
    }
  });
});

describe("HD8 review #1 · khoá đối tác có NUL ⇒ 400, không 500", () => {
  it("PUT /partners/ratings, PUT /companies?party=, POST /companies/refresh?party=", async () => {
    await arrangeHd8(c);
    const bad = "tax:03\u000011";
    const r1 = await call(c, P.hoa, "PUT", "/partners/ratings", {
      party: bad,
      role: "supplier",
      criterion: "quality",
      value: 50,
    });
    const r2 = await call(c, P.hoa, "PUT", `/companies?party=${enc(bad)}`, { short_name: "x" });
    const r3 = await call(c, P.hoa, "POST", `/companies/refresh?party=${enc(bad)}`);
    const r4 = await call(c, P.hoa, "GET", `/partners/score?party=${enc(bad)}&role=supplier`);
    expect([r1.status, r2.status, r3.status, r4.status]).toEqual([400, 400, 400, 400]);
  });
});

describe("HD8 review #3 · trần kiểm link theo người dùng", () => {
  it("10 lần/phút ⇒ lần 11 = 429 LINK_CHECK_LIMIT; người khác không bị ảnh hưởng; báo giá có link cũng tính", async () => {
    await arrangeHd8(c);
    const check = (who: typeof P.hoa) =>
      call(c, who, "POST", "/prices/check-link", { url: "http://127.0.0.1/", price: 1 });
    for (let i = 0; i < 10; i++) expect((await check(P.hoa)).status).toBe(200);
    const over = await check(P.hoa);
    expect([over.status, over.json?.error?.code]).toEqual([429, "LINK_CHECK_LIMIT"]);
    expect((await check(P.lan)).status).toBe(200);
    const quote = await call(c, P.hoa, "POST", "/prices/quotes", {
      product: "name:thit heo|",
      supplier_name: "Ai đó",
      price: 1,
      quoted_at: "2026-10-10",
      url: "http://10.0.0.1/",
    });
    expect(quote.status).toBe(429);
  });
});

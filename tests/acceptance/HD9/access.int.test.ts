// HD-FR-91…96 · BR-3 · BR-4 · HD9-AC07 · D9-17: quyền gói (viewer đọc, editor/owner ghi, không Group bị chặn) và cách ly tenant
// trên mọi route CKS. Viết TRƯỚC code (làn đầy đủ: quyền/tenant). Guard chạy trước đọc thân ⇒ viewer gửi thân rác vẫn 403.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  arrangeCks,
  type CtxN1,
  customerNamed,
  d,
  kcall,
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

const READS = ["/overview", "/customers", "/lots", "/prices", "/scans"] as const;

describe("HD9-AC07 · quyền gói", () => {
  it("viewer: mọi GET 200; mọi POST 403 PACK_FORBIDDEN (kể cả thân rác) và không ghi gì", async () => {
    await arrangeCks(c);
    const w = await world(c);
    for (const path of READS) {
      const r = await kcall(c, P.tam, "GET", path);
      expect({ path, status: r.status }).toEqual({ path, status: 200 });
    }
    const one = await kcall(c, P.tam, "GET", `/customers/${w.tt.company_id}`);
    expect(one.status).toBe(200);
    const docs = await kcall(c, P.tam, "GET", `/signed-docs?customer_id=${w.tt.company_id}`);
    expect(docs.status).toBe(200);
    const posts: [string, unknown][] = [
      ["/lots", { garbage: true }],
      ["/sales", {}],
      ["/certificates", {}],
      [`/groups/${w.bv.contract_id}/renew`, {}],
      [`/renewals/${crypto.randomUUID()}/complete`, {}],
      [`/renewals/${crypto.randomUUID()}/lost`, {}],
      [`/customers/${w.tt.company_id}/followups`, {}],
      ["/scans", {}],
    ];
    const before = await c.sql`select (select count(*) from contracts.cks_lots)::int as l,
      (select count(*) from contracts.cks_renewals)::int as r, (select count(*) from contracts.cks_followups)::int as f`;
    for (const [path, body] of posts) {
      const r = await kcall(c, P.tam, "POST", path, body);
      expect({ path, status: r.status, code: r.json?.error?.code }).toEqual({
        path,
        status: 403,
        code: "PACK_FORBIDDEN",
      });
    }
    const up = await fetch(`${c.hub.base}/pack/contracts/cks/signed-docs/upload`, {
      method: "POST",
      headers: { authorization: `Bearer ${await c.tok(P.tam)}` },
      body: new FormData(),
    });
    expect(up.status).toBe(403);
    const after = await c.sql`select (select count(*) from contracts.cks_lots)::int as l,
      (select count(*) from contracts.cks_renewals)::int as r, (select count(*) from contracts.cks_followups)::int as f`;
    expect(after).toEqual(before);
  });
  it("không Group: GET và POST đều 403; editor và owner ghi được", async () => {
    await arrangeCks(c);
    expect((await kcall(c, P.cuc, "GET", "/overview")).status).toBe(403);
    expect((await kcall(c, P.cuc, "POST", "/lots", {})).status).toBe(403);
    const lot = { ca: "Viettel-CA", qty: 1, unit_cost: 1, bought_at: d(0), device: "token" };
    expect((await kcall(c, P.hoa, "POST", "/lots", lot)).status).toBe(201);
    expect((await kcall(c, P.lan, "POST", "/lots", lot)).status).toBe(201);
  });
  it("thân có tenant_id hay khoá lạ ⇒ 400 (tenant chỉ lấy từ token)", async () => {
    await arrangeCks(c);
    const r = await kcall(c, P.hoa, "POST", "/lots", {
      ca: "Viettel-CA",
      qty: 1,
      unit_cost: 1,
      bought_at: d(0),
      device: "token",
      tenant_id: crypto.randomUUID(),
    });
    expect(r.status).toBe(400);
  });
});

describe("HD9-AC07 · cách ly tenant", () => {
  it("beta không thấy và không chạm được dữ liệu acme: danh sách rỗng, id ⇒ 404, bán từ lô acme ⇒ 404", async () => {
    await arrangeCks(c);
    const w = await world(c);
    const bvId = (await customerNamed(c, "Bếp Việt")).company_id as string;
    expect((await kcall(c, P.an, "GET", "/customers")).json).toMatchObject({ items: [], total: 0 });
    expect((await kcall(c, P.an, "GET", "/lots")).json).toEqual([]);
    expect((await kcall(c, P.an, "GET", "/overview")).json).toEqual({
      certificates: 0,
      customers: 0,
      expiring_30: 0,
      expired: 0,
      in_stock: 0,
    });
    expect((await kcall(c, P.an, "GET", "/prices")).json.rows).toEqual([]);
    expect((await kcall(c, P.an, "GET", `/customers/${bvId}`)).status).toBe(404);
    expect((await kcall(c, P.an, "GET", `/signed-docs?customer_id=${bvId}`)).json).toEqual([]);
    const sale = await kcall(c, P.an, "POST", "/sales", {
      company_name: "Beta",
      lot_id: w.lot.id,
      price_each: 1,
      signed_at: d(0),
      valid_to: d(365),
      holders: [{ name: "A", device: "token" }],
    });
    expect(sale.status).toBe(404);
    expect((await kcall(c, P.an, "POST", `/groups/${w.bv.contract_id}/renew`, {})).status).toBe(
      404,
    );
    const ren = (await kcall(c, P.hoa, "POST", `/groups/${w.bv.contract_id}/renew`, {})).json;
    expect(
      (
        await kcall(c, P.an, "POST", `/renewals/${ren.id}/complete`, {
          serials: {},
          valid_to: null,
        })
      ).status,
    ).toBe(404);
    expect((await kcall(c, P.an, "POST", `/renewals/${ren.id}/lost`, { reason: "x" })).status).toBe(
      404,
    );
    expect(
      (await kcall(c, P.an, "POST", `/customers/${bvId}/followups`, { at: `${d(1)}T09:00` }))
        .status,
    ).toBe(404);
    // Serial của acme không chặn beta (khoá duy nhất theo tenant, không lộ tồn tại).
    const own = await kcall(c, P.an, "POST", "/certificates", {
      company_name: "Beta Co",
      ca: "FPT-CA",
      serial: "FPT-1",
      valid_to: d(30),
      device: "token",
    });
    expect(own.status).toBe(201);
  });
  it("id sai dạng ⇒ 400; tham số lọc lạ ⇒ 400", async () => {
    await arrangeCks(c);
    expect((await kcall(c, P.tam, "GET", "/customers/not-a-uuid")).status).toBe(400);
    expect((await kcall(c, P.tam, "GET", "/customers?filter=nope")).status).toBe(400);
    expect((await kcall(c, P.tam, "GET", "/signed-docs")).status).toBe(400);
  });
});

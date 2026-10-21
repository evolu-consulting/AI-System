// V2-J2 · SP-04/05/06 qua hub-api THẬT: tab NCC & giá — so sánh với giá vốn BQ, AI tìm giá (chỉ khi bấm, chỉ gửi tên SP, AI giả),
// lưu vào bảng so sánh, gợi ý; quyền (viewer đọc được, không tìm/lưu); tenant khác không thấy SP/giá; SP Giới thiệu không có tab.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  BASE,
  type CtxJ2,
  type Json,
  P,
  seedProduct,
  seedScoutAgent,
  startJ2,
  T,
} from "./_support/v2j2";

let c: CtxJ2;
let pid: string;
beforeAll(async () => {
  c = await startJ2();
  await c.sql`truncate contracts.products cascade`;
  await c.sql`truncate contracts.price_scout_usage, contracts.price_scout_quota, contracts.price_scout_defaults`;
  await seedScoutAgent(c, "SYS-SCOUT"); // price-scout: "Tìm giá" chạy qua agent Hub (model/prompt ở Hub)
  pid = await seedProduct(c, {
    tenant: T.acme,
    name: "USB Token ký số",
    avgCost: 100_000,
    supplier: { key: "tax:0100684378", unitCost: 100_000, qty: 80 },
  });
}, 120_000);
afterAll(async () => {
  await c?.stop();
});

type Person = (typeof P)[keyof typeof P];
const call = (p: Person, method: string, path: string, body?: unknown) =>
  c.hubCall(p, method, `${BASE}${path}`, body);

const REPLY = JSON.stringify({
  items: [
    {
      supplier_name: "FPT IS",
      kind: "renew",
      price: 90_000,
      unit: "cái",
      url: "https://fpt.vn/token",
    },
    {
      supplier_name: "Viettel",
      kind: "new",
      price: 130_000,
      url: "https://viettel.vn/t",
      seen_on: "2026-10-05",
    },
  ],
});

describe("V2-J2 · tab NCC & giá", () => {
  it("đường chính: so sánh ⇒ AI tìm giá (chỉ tên SP) ⇒ lưu ⇒ hiện trong bảng ⇒ xoá", async () => {
    const before = await call(P.tam, "GET", `/products/${pid}/suppliers`);
    expect(before.status).toBe(200);
    expect(before.json).toMatchObject({
      own_avg_cost: 100_000,
      rows: [{ source: "purchase", kind: "new", price: 100_000, vs_own_pct: 0 }],
      suppliers: [{ party_key: "tax:0100684378", bought_qty: "80", advice: "keep" }],
    });

    c.ai.next = { text: REPLY };
    const found = await call(P.hoa, "POST", `/products/${pid}/suppliers/search`, {});
    expect(found.status).toBe(200);
    expect(found.json.items.map((i: Json) => [i.supplier_name, i.kind, i.price])).toEqual([
      ["FPT IS", "renew", 90_000],
      ["Viettel", "new", 130_000],
    ]);
    // price-scout: lệnh hệ thống của agent Hub; lời nhắc = JSON dữ liệu, chỉ tên SP + cấu hình dò (SP chưa cấu hình ⇒ mặc định
    // rỗng); bật tìm web; không MST / tên NCC đã mua / tên tenant trong lời nhắc.
    expect(c.ai.calls).toHaveLength(1);
    expect(c.ai.calls[0]?.webSearch).toBe(true);
    expect(c.ai.calls[0]?.system).toBe("SYS-SCOUT");
    const prompt = c.ai.calls[0]?.prompt as string;
    expect(JSON.parse(prompt)).toEqual({
      product: "USB Token ký số",
      keywords: [],
      spec: null,
      unit: null,
      include_sites: [],
      exclude_sites: [],
      watched_suppliers: [],
      region: null,
      vat: "excl",
    });
    expect(prompt).not.toMatch(/0100684378|acme/i);

    const saved = await call(P.hoa, "POST", `/products/${pid}/supplier-prices`, {
      items: found.json.items.map((i: Json) => ({ ...i, source: "market" })),
    });
    expect(saved.status).toBe(201);
    const after: Json = (await call(P.tam, "GET", `/products/${pid}/suppliers`)).json;
    const fpt = after.rows.find((r: Json) => r.supplier_name === "FPT IS");
    expect(fpt).toMatchObject({ source: "market", kind: "renew", price: 90_000, vs_own_pct: -10 });
    expect(after.suppliers.find((s: Json) => s.supplier_name === "FPT IS")?.advice).toBe("trial");

    const del = await call(P.hoa, "DELETE", `/products/${pid}/supplier-prices/${fpt.id}`);
    expect(del.status).toBe(204);
    const gone: Json = (await call(P.tam, "GET", `/products/${pid}/suppliers`)).json;
    expect(gone.rows.some((r: Json) => r.supplier_name === "FPT IS")).toBe(false);
  });

  it("viewer không tìm/lưu (403, không gọi AI); AI hỏng ⇒ 503/502; thân lạ ⇒ 400", async () => {
    const calls = c.ai.calls.length;
    for (const [m, path, b] of [
      ["POST", `/products/${pid}/suppliers/search`, {}],
      ["POST", `/products/${pid}/supplier-prices`, { items: [] }],
    ] as const)
      expect((await call(P.tam, m, path, b)).status).toBe(403);
    expect(c.ai.calls).toHaveLength(calls);
    c.ai.next = { code: "UNAVAILABLE" };
    expect((await call(P.hoa, "POST", `/products/${pid}/suppliers/search`, {})).status).toBe(503);
    c.ai.next = { text: "xin lỗi, không tìm được" };
    expect((await call(P.hoa, "POST", `/products/${pid}/suppliers/search`, {})).status).toBe(502);
    // khoá lạ (vd người gọi cố đưa thêm dữ liệu ra ngoài) ⇒ 400
    expect(
      (await call(P.hoa, "POST", `/products/${pid}/suppliers/search`, { tax_id: "0100684378" }))
        .status,
    ).toBe(400);
  });

  it("tenant khác không thấy SP/giá (404); SP Giới thiệu không có tab (404)", async () => {
    c.ai.next = { text: REPLY };
    const item = { supplier_name: "FPT", kind: "new", price: 95_000, source: "manual" };
    expect(
      (await call(P.hoa, "POST", `/products/${pid}/supplier-prices`, { items: [item] })).status,
    ).toBe(201);
    const mine: Json = (await call(P.hoa, "GET", `/products/${pid}/suppliers`)).json;
    const priceId = mine.rows.find((r: Json) => r.supplier_name === "FPT").id;

    const count = async () =>
      (
        await c.sql<
          { n: number }[]
        >`select count(*)::int as n from contracts.product_supplier_prices
          where tenant_id = ${T.acme} and product_id = ${pid}`
      )[0]?.n;
    const rowsBefore = await count();
    for (const [m, path, b] of [
      ["GET", `/products/${pid}/suppliers`, undefined],
      ["POST", `/products/${pid}/suppliers/search`, {}],
      ["POST", `/products/${pid}/supplier-prices`, { items: [item] }],
      ["DELETE", `/products/${pid}/supplier-prices/${priceId}`, undefined],
    ] as const)
      expect({ path, status: (await call(P.an, m, path, b)).status }).toEqual({
        path,
        status: 404,
      });
    // tenant khác không thêm/xoá được dòng nào của tenant này
    expect(await count()).toBe(rowsBefore);

    const ref = await seedProduct(c, { tenant: T.acme, name: "Phí giới thiệu", group: "referral" });
    expect((await call(P.hoa, "GET", `/products/${ref}/suppliers`)).status).toBe(404);
    expect((await call(P.hoa, "POST", `/products/${ref}/suppliers/search`, {})).status).toBe(404);
  });
});

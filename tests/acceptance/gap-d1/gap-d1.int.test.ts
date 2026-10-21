// gap-d1 · Sổ Hợp Tác › Sản phẩm & Giá qua hub-api THẬT (AI giả): #18 thêm SP tay (spec) + nhập lô tay (BQ giữ nguyên), #19 cách lấy
// hàng + rủi ro phụ thuộc NCC, #21 tải báo giá (AI đọc, chỉ dòng giá chưa lưu); quyền (viewer 403) + tenant khác 404 (RLS).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { BASE, type CtxJ2, type Json, P, seedProduct, startJ2, T } from "../V2-J2/_support/v2j2";

let c: CtxJ2;
beforeAll(async () => {
  c = await startJ2();
  await c.sql`truncate contracts.products cascade`;
}, 120_000);
afterAll(async () => {
  await c?.stop();
});

type Person = (typeof P)[keyof typeof P];
const call = (p: Person, method: string, path: string, body?: unknown) =>
  c.hubCall(p, method, `${BASE}${path}`, body);
const upload = async (p: Person, path: string, bytes: Uint8Array) => {
  const form = new FormData();
  form.set("file", new File([bytes.slice()], "bao-gia.txt"));
  const res = await fetch(`${c.hub.base}${BASE}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${await c.tok(p)}` },
    body: form,
  });
  return { status: res.status, json: (await res.json().catch(() => undefined)) as Json };
};

describe("gap-d1 #18 · thêm SP tay + nhập lô tay", () => {
  it("SP có quy cách; nhập hai lô ⇒ giá vốn BQ gia quyền; dòng sổ manual; viewer 403; tenant khác 404", async () => {
    const made = await call(P.hoa, "POST", "/products", {
      name: "Cáp mạng Cat6",
      group: "goods",
      unit: "cuộn",
      spec: "305m, lõi đồng",
    });
    expect(made.status).toBe(201);
    expect(made.json).toMatchObject({ name: "Cáp mạng Cat6", spec: "305m, lõi đồng" });
    const pid = made.json.id as string;

    const lot1 = await call(P.hoa, "POST", `/products/${pid}/lots`, {
      qty: "5",
      unit_price: 100_000,
      supplier: { name: "Công ty A", tax_id: "0100684378" },
    });
    expect(lot1.status).toBe(201);
    expect(lot1.json).toMatchObject({ on_hand_after: "5", avg_cost_after: 100_000 });
    const lot2 = await call(P.hoa, "POST", `/products/${pid}/lots`, {
      qty: "5",
      unit_price: 200_000,
    });
    expect(lot2.json).toMatchObject({
      on_hand_before: "5",
      on_hand_after: "10",
      avg_cost_after: 150_000,
    });

    const d: Json = (await call(P.hoa, "GET", `/products/${pid}`)).json;
    expect(d.spec).toBe("305m, lõi đồng");
    expect(d.components[0]).toMatchObject({ on_hand: "10", avg_cost: 150_000 });
    expect(d.lots).toHaveLength(2);
    expect(d.moves.map((m: Json) => m.reason)).toEqual(["manual", "manual"]);

    const bad = await call(P.hoa, "POST", `/products/${pid}/lots`, { qty: "0", unit_price: 1 });
    expect(bad.status).toBe(422);
    expect(
      (await call(P.tam, "POST", `/products/${pid}/lots`, { qty: "1", unit_price: 1 })).status,
    ).toBe(403);
    expect(
      (await call(P.an, "POST", `/products/${pid}/lots`, { qty: "1", unit_price: 1 })).status,
    ).toBe(404);
    const [n] = await c.sql<{ n: number }[]>`select count(*)::int as n from contracts.stock_lots`;
    expect(n?.n).toBe(2);
  });
});

describe("gap-d1 #19 · cách lấy hàng + rủi ro phụ thuộc NCC", () => {
  it("thêm / liệt kê (hợp NCC đã mua + khai báo) / trùng 409 / xoá; viewer đọc được không ghi; tenant khác 404; Giới thiệu 404", async () => {
    const pid = await seedProduct(c, {
      tenant: T.acme,
      name: "USB Token",
      avgCost: 100_000,
      supplier: { key: "tax:0100684378", unitCost: 100_000, qty: 80 },
    });
    const solo: Json = (await call(P.tam, "GET", `/products/${pid}/sources`)).json;
    expect(solo).toMatchObject({ items: [], single_source: true });
    expect(solo.risk).toMatchObject([
      { party_key: "tax:0100684378", share_pct: 100, level: "high", declared: false },
    ]);

    const body = {
      supplier_name: "Viettel",
      supplier_tax_id: "0100109106",
      lead_days: 5,
      moq: "10",
      price_ref: 120_000,
    };
    const added = await call(P.hoa, "POST", `/products/${pid}/sources`, body);
    expect(added.status).toBe(201);
    expect(added.json).toMatchObject({
      supplier_name: "Viettel",
      lead_days: 5,
      moq: "10",
      price_ref: 120_000,
    });
    expect((await call(P.hoa, "POST", `/products/${pid}/sources`, body)).status).toBe(409);

    const list: Json = (await call(P.tam, "GET", `/products/${pid}/sources`)).json;
    expect(list.single_source).toBe(false);
    expect(list.items).toHaveLength(1);
    expect(list.risk.map((r: Json) => [r.share_pct, r.declared, r.level])).toEqual([
      [100, false, "medium"],
      [0, true, "low"],
    ]);

    expect((await call(P.tam, "POST", `/products/${pid}/sources`, body)).status).toBe(403);
    expect((await call(P.an, "GET", `/products/${pid}/sources`)).status).toBe(404);
    expect((await call(P.an, "POST", `/products/${pid}/sources`, body)).status).toBe(404);
    expect((await call(P.an, "DELETE", `/products/${pid}/sources/${added.json.id}`)).status).toBe(
      404,
    );
    const ref = await seedProduct(c, { tenant: T.acme, name: "Phí giới thiệu", group: "referral" });
    expect((await call(P.hoa, "GET", `/products/${ref}/sources`)).status).toBe(404);

    expect((await call(P.hoa, "DELETE", `/products/${pid}/sources/${added.json.id}`)).status).toBe(
      204,
    );
    expect(((await call(P.tam, "GET", `/products/${pid}/sources`)).json as Json).items).toEqual([]);
  });
});

describe("gap-d1 #21 · tải báo giá lên", () => {
  it("AI đọc báo giá (chỉ tên SP + chữ báo giá, không tìm web) ⇒ dòng chưa lưu; lưu làm giá tham khảo (quote)", async () => {
    const pid = await seedProduct(c, { tenant: T.acme, name: "Switch 24 cổng", avgCost: 100_000 });
    c.ai.next = {
      text: JSON.stringify({
        items: [
          { supplier_name: "Công ty B", kind: "new", price: 95_000, unit: "cái", note: "chưa VAT" },
          { supplier_name: "Rác", price: "x" },
        ],
      }),
    };
    const before = c.ai.calls.length;
    const r = await upload(
      P.hoa,
      `/products/${pid}/supplier-prices/read-quote`,
      new TextEncoder().encode("Báo giá Switch 24 cổng: 95.000đ"),
    );
    expect(r.status).toBe(200);
    expect(r.json.items).toMatchObject([
      { supplier_name: "Công ty B", kind: "new", price: 95_000, url: null },
    ]);
    expect(c.ai.calls).toHaveLength(before + 1);
    const call0 = c.ai.calls[before];
    expect(call0?.webSearch).toBe(false);
    expect(JSON.parse(call0?.prompt as string)).toEqual({
      product: "Switch 24 cổng",
      quote_text: "Báo giá Switch 24 cổng: 95.000đ",
    });
    // chưa lưu gì
    expect(
      ((await call(P.tam, "GET", `/products/${pid}/suppliers`)).json as Json).rows.some(
        (x: Json) => x.source === "quote",
      ),
    ).toBe(false);
    const saved = await call(P.hoa, "POST", `/products/${pid}/supplier-prices`, {
      items: r.json.items.map((i: Json) => ({ ...i, url: null, source: "quote" })),
    });
    expect(saved.status).toBe(201);
    const rows: Json = (await call(P.tam, "GET", `/products/${pid}/suppliers`)).json;
    expect(rows.rows.find((x: Json) => x.source === "quote")).toMatchObject({
      supplier_name: "Công ty B",
      price: 95_000,
    });
  });

  it("ảnh/nhị phân 415 (không gọi AI); viewer 403; tenant khác 404; AI hỏng 503/502", async () => {
    const pid = await seedProduct(c, { tenant: T.acme, name: "Router", avgCost: 50_000 });
    const path = `/products/${pid}/supplier-prices/read-quote`;
    const calls = c.ai.calls.length;
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
    expect((await upload(P.hoa, path, png)).status).toBe(415);
    expect((await upload(P.tam, path, new TextEncoder().encode("x"))).status).toBe(403);
    expect((await upload(P.an, path, new TextEncoder().encode("x"))).status).toBe(404);
    expect(c.ai.calls).toHaveLength(calls);
    c.ai.next = { code: "UNAVAILABLE" };
    expect((await upload(P.hoa, path, new TextEncoder().encode("Router 1.000.000"))).status).toBe(
      503,
    );
    c.ai.next = { text: "không đọc được" };
    expect((await upload(P.hoa, path, new TextEncoder().encode("Router 1.000.000"))).status).toBe(
      502,
    );
  });
});

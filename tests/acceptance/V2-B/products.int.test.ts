// V2-B · API danh mục SP qua hub-api THẬT (BA §2 nhóm SP + cách lấy hàng, §5.5b gợi ý theo quy tắc nhận diện ⇒ trùng từ ⇒ tạo mới,
// §5.5c/d SP mới từ dòng HĐ + NCC chính, §5.5f thành phần). Quyền: viewer chỉ đọc; tenant khác không thấy.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  arrangeHd7,
  BASE,
  type CtxN1,
  deal,
  type Json,
  ok,
  P,
  startHd1,
  T,
} from "../HD7/_support/hd7";

let c: CtxN1;
beforeAll(async () => {
  c = await startHd1();
  await arrangeHd7(c);
  await c.sql`truncate contracts.products cascade`;
}, 120_000);
afterAll(async () => {
  await c?.stop();
});

type Person = (typeof P)[keyof typeof P];
const call = (p: Person, method: string, path: string, body?: unknown) =>
  c.hubCall(p, method, `${BASE}${path}`, body);
const CKS = {
  name: "Chữ ký số DN – USB Token",
  unit: "bộ",
  group: "service",
  components: [{ name: "Chứng thư số" }, { name: "USB Token", unit: "cái", mode: "stock" }],
  rules: [{ pattern: "USB", component: 1 }],
  main_supplier: { name: "Công ty VNPT", tax_id: "0100684378" },
};
let cks: Json;

describe("V2-B · POST /products", () => {
  it("tạo SP nhiều thành phần + quy tắc + NCC chính; mặc định cách lấy hàng theo nhóm", async () => {
    const buy = await deal(c.sql, { sale: false, partner: "Công ty VNPT", tax: "0100684378" });
    cks = await ok(call(P.hoa, "POST", "/products", { ...CKS, from_contract_id: buy }));
    expect(cks).toMatchObject({
      name: CKS.name,
      group: "service",
      main_supplier: { party_key: "tax:0100684378", name: "Công ty VNPT" },
      created_from_contract_id: buy,
      components: [
        { ord: 0, name: "Chứng thư số", unit: "bộ", mode: "quota", on_hand: "0", avg_cost: 0 },
        { ord: 1, name: "USB Token", unit: "cái", mode: "stock", on_hand: "0", avg_cost: 0 },
      ],
    });
    expect(cks.rules).toEqual([
      { id: expect.any(String), pattern: "USB", component_id: cks.components[1].id },
    ]);
    const tape = await ok(
      call(P.hoa, "POST", "/products", { name: "Băng keo 5cm", unit: "cuộn", group: "goods" }),
    );
    expect(tape.components).toMatchObject([{ name: "Băng keo 5cm", mode: "stock" }]);
    const order = await ok(
      call(P.hoa, "POST", "/products", { name: "CKS cá nhân", group: "service", no_stock: true }),
    );
    expect(order.components).toMatchObject([{ mode: "order" }]);
  });

  it("trùng tên (bỏ dấu, hoa thường) ⇒ 409; cách lấy hàng trái nhóm ⇒ 422; thân sai ⇒ 400; viewer ⇒ 403", async () => {
    const dup = await call(P.hoa, "POST", "/products", {
      name: "chu ky so dn – usb token",
      group: "service",
    });
    expect([dup.status, dup.json?.error?.code ?? dup.json?.code]).toEqual([409, "PRODUCT_EXISTS"]);
    const bad = await call(P.hoa, "POST", "/products", {
      name: "Bảo hiểm xe",
      group: "referral",
      components: [{ name: "Bảo hiểm xe", mode: "stock" }],
    });
    expect([bad.status, bad.json?.error?.code ?? bad.json?.code]).toEqual([422, "PRODUCT_INVALID"]);
    expect((await call(P.hoa, "POST", "/products", { name: "X", group: "food" })).status).toBe(400);
    expect(
      (await call(P.hoa, "POST", "/products", { name: "X", group: "goods", extra: 1 })).status,
    ).toBe(400);
    expect((await call(P.tam, "POST", "/products", { name: "Y", group: "goods" })).status).toBe(
      403,
    );
  });

  it("HĐ nguồn của tenant khác ⇒ 404, không tạo", async () => {
    const other = await deal(c.sql, { sale: false, tenant: T.beta });
    const r = await call(P.hoa, "POST", "/products", {
      name: "Z lạ",
      group: "goods",
      from_contract_id: other,
    });
    expect(r.status).toBe(404);
    const list = await ok(call(P.hoa, "GET", "/products?q=z la"));
    expect(list.items).toEqual([]);
  });
});

describe("V2-B · đọc + gợi ý + quy tắc", () => {
  it("GET /products lọc nhóm + tìm bỏ dấu; viewer đọc được; tenant khác không thấy (danh sách rỗng, chi tiết 404)", async () => {
    const svc = await ok(call(P.tam, "GET", "/products?group=service&q=usb"));
    expect(svc.items.map((p: Json) => p.name)).toEqual([CKS.name]);
    const goods = await ok(call(P.hoa, "GET", "/products?group=goods"));
    expect(goods.items.map((p: Json) => p.name)).toEqual(["Băng keo 5cm"]);
    expect((await ok(call(P.an, "GET", "/products"))).items).toEqual([]);
    expect((await call(P.an, "GET", `/products/${cks.id}`)).status).toBe(404);
    const d = await ok(call(P.tam, "GET", `/products/${cks.id}`));
    expect([d.id, d.lots, d.moves]).toEqual([cks.id, [], []]);
    expect((await call(P.hoa, "GET", "/products/not-a-uuid")).status).toBe(400);
  });

  it("POST /products/match: quy tắc 'USB' ⇒ SP CKS + thành phần USB Token; trùng từ; không khớp ⇒ đề xuất tạo", async () => {
    const r1 = await ok(
      call(P.hoa, "POST", "/products/match", { text: "USB Token trắng", deal: "buy" }),
    );
    expect(r1.suggestions.map((s: Json) => [s.product.id, s.component_id, s.by])).toEqual([
      [cks.id, cks.components[1].id, "rule"],
    ]);
    const r2 = await ok(
      call(P.hoa, "POST", "/products/match", { text: "BĂNG KEO 5CM trong", deal: "sell" }),
    );
    expect(r2.suggestions[0]).toMatchObject({ product: { name: "Băng keo 5cm" }, by: "words" });
    const r3 = await ok(call(P.hoa, "POST", "/products/match", { text: "Thùng phi 200L" }));
    expect(r3).toEqual({ suggestions: [], create: { name: "Thùng phi 200L" } });
  });

  it("thêm quy tắc ⇒ 201; trùng ⇒ 409; xoá ⇒ 204, xoá lại ⇒ 404; thành phần của SP khác ⇒ 404", async () => {
    const rule = await ok(
      call(P.hoa, "POST", `/products/${cks.id}/rules`, { pattern: "chữ ký số" }),
    );
    expect(rule).toMatchObject({ pattern: "chữ ký số", component_id: null });
    expect(
      (await call(P.hoa, "POST", `/products/${cks.id}/rules`, { pattern: "CHU KY SO" })).status,
    ).toBe(409);
    const tape = (await ok(call(P.hoa, "GET", "/products?group=goods"))).items[0];
    const foreign = await call(P.hoa, "POST", `/products/${cks.id}/rules`, {
      pattern: "keo",
      component_id: tape.components[0].id,
    });
    expect(foreign.status).toBe(404);
    expect((await call(P.hoa, "DELETE", `/products/${cks.id}/rules/${rule.id}`)).status).toBe(204);
    expect((await call(P.hoa, "DELETE", `/products/${cks.id}/rules/${rule.id}`)).status).toBe(404);
    expect(
      (await call(P.tam, "DELETE", `/products/${cks.id}/rules/${cks.rules[0].id}`)).status,
    ).toBe(403);
  });
});

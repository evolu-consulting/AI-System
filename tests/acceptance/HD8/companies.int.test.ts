// HD8-FR-05 (kiểm link) · HD8-FR-08 (giá thị trường hàng hoá) · HD8-FR-09 (danh bạ công ty, tên ngắn) qua hub-api thật — parity mgmt-app
// `tests/test_prices.py` (market_range, link_check từ chối máy nội bộ) + `routes/companies.py` (câu lỗi, mã). Không mạng thật:
// link nội bộ bị từ chối trước khi mở; Cục Thuế không cấu hình trong test ⇒ "chưa tra được".
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  ago,
  arrangeHd8,
  type CtxN1,
  call,
  d,
  deal,
  items,
  type Json,
  ok,
  P,
  record,
  startHd1,
  T,
} from "./_support/hd8";

let c: CtxN1;
beforeAll(async () => {
  c = await startHd1();
}, 120_000);
afterAll(async () => {
  await c?.stop();
});
const PORK = "name:thit heo|";
const enc = encodeURIComponent;

async function pork() {
  await arrangeHd8(c);
  const id = await deal(c.sql, {
    sale: false,
    partner: "Thực phẩm Sạch Bình An",
    tax: "0322223333",
    number: "TH-1",
  });
  await items(c.sql, T.acme, id, [{ name: "Thịt heo", unit: "kg", unit_price: 98_000 }]);
  for (let i = 0; i < 4; i++)
    await record(c.sql, T.acme, "tax:0322223333", "supplier", "delivered", ago(10 + i * 20), {
      days_late: 0,
    });
}

describe("HD8-FR-05 · kiểm link báo giá (link_check)", () => {
  it("link tới máy nội bộ ⇒ «Link không hợp lệ», báo giá vẫn lưu, chưa kiểm; viewer 403", async () => {
    await pork();
    const r = await ok(
      call(c, P.hoa, "POST", "/prices/check-link", { url: "http://127.0.0.1:9200/", price: 1 }),
    );
    expect(r).toEqual({ verified: false, page_date: null, note: "Link không hợp lệ" });
    expect(
      (await call(c, P.tam, "POST", "/prices/check-link", { url: "http://127.0.0.1/", price: 1 }))
        .status,
    ).toBe(403);
    expect(
      (await call(c, P.hoa, "POST", "/prices/check-link", { url: "file:///etc/passwd", price: 1 }))
        .status,
    ).toBe(400);
    await ok(
      call(c, P.hoa, "POST", "/prices/quotes", {
        product: PORK,
        supplier_name: "Heo Web",
        price: 93_000,
        quoted_at: "2026-10-10",
        url: "http://10.0.0.1/gia",
      }),
    );
    const [q] = await c.sql<
      { source: string; verified: boolean; check_note: string }[]
    >`select source, verified, check_note
      from contracts.price_quotes`;
    expect(q).toEqual({ source: "website", verified: false, check_note: "Link không hợp lệ" });
    const cmp = await ok(call(c, P.lan, "GET", `/prices/compare?product=${enc(PORK)}`));
    expect(cmp.rows.find((x: Json) => x.supplier === "Heo Web").source).toMatchObject({
      type: "website",
      verified: false,
    });
  });
});

describe("HD8-FR-08 · giá thị trường hàng hoá (test_market_range_is_tbd_until_observations_exist)", () => {
  it("chưa có quan sát ⇒ tbd; có 2 quan sát 30 ngày ⇒ ok + min/max/ngày/số nguồn; quá 30 ngày không tính", async () => {
    await pork();
    expect(
      (await ok(call(c, P.lan, "GET", `/prices/compare?product=${enc(PORK)}`))).market,
    ).toEqual({ status: "tbd" });
    const seen = d(0);
    for (const [p, s] of [
      [90_000, seen],
      [101_000, seen],
      [50_000, d(-31)],
    ] as const)
      await c.sql`insert into contracts.market_observations (tenant_id, product_key, price_ex_vat, seen)
        values (${T.acme}, ${PORK}, ${p}, ${s})`;
    expect(
      (await ok(call(c, P.lan, "GET", `/prices/compare?product=${enc(PORK)}`))).market,
    ).toEqual({
      status: "ok",
      min: 90_000,
      max: 101_000,
      seen,
      n: 2,
    });
  });
});

describe("HD8-FR-09 · danh bạ công ty (routes/companies.py)", () => {
  it("tạo / trùng / MST sai / Cục Thuế chưa tra được; sửa tên ngắn ⇒ danh sách đối tác dùng tên ngắn; tra lại; quyền", async () => {
    await pork();
    const bad = await call(c, P.hoa, "POST", "/companies", { tax_id: "12ab" });
    expect([bad.status, bad.json?.error?.message]).toEqual([
      422,
      "MST phải có 10 chữ số, 13 chữ số (chi nhánh) hoặc 12 chữ số (cá nhân)",
    ]);
    const none = await call(c, P.hoa, "POST", "/companies", {});
    expect([none.status, none.json?.error?.message]).toEqual([422, "Cần MST hoặc tên công ty"]);
    const busy = await call(c, P.hoa, "POST", "/companies", { tax_id: "0322223333" });
    expect([busy.status, busy.json?.error?.message]).toEqual([
      503,
      "Chưa tra được Cục Thuế; nhập tên công ty để lưu trước",
    ]);
    const made = await call(c, P.hoa, "POST", "/companies", {
      tax_id: "0322223333",
      name: "Công ty TNHH Thực phẩm Sạch Bình An",
    });
    expect([made.status, made.json?.party, made.json?.edited]).toEqual([
      201,
      "tax:0322223333",
      ["name"],
    ]);
    expect(
      (await call(c, P.hoa, "POST", "/companies", { tax_id: "0322223333", name: "X" })).status,
    ).toBe(409);
    expect((await call(c, P.tam, "POST", "/companies", { name: "Y" })).status).toBe(403);
    const put = await ok(
      call(c, P.hoa, "PUT", `/companies?party=${enc("tax:0322223333")}`, { short_name: "Bình An" }),
    );
    expect([put.short_name, put.edited]).toEqual(["Bình An", ["name", "short_name"]]);
    const empty = await call(c, P.hoa, "PUT", `/companies?party=${enc("tax:0322223333")}`, {
      name: " ",
    });
    expect([empty.status, empty.json?.error?.message]).toEqual([
      422,
      "Tên công ty không được để trống",
    ]);
    expect(
      (await call(c, P.hoa, "PUT", `/companies?party=${enc("tax:1")}`, { name: "Z" })).status,
    ).toBe(404);
    const rows: Json[] = await ok(call(c, P.tam, "GET", "/partners"));
    expect(rows.map((p: Json) => p.name)).toEqual(["Bình An"]);
    const list: Json[] = await ok(call(c, P.tam, "GET", `/companies?q=${enc("binh an")}`));
    expect(list.map((x: Json) => [x.party, x.contract_count, x.roles])).toEqual([
      ["tax:0322223333", 1, ["supplier"]],
    ]);
    const ref = await call(c, P.hoa, "POST", `/companies/refresh?party=${enc("tax:0322223333")}`);
    expect([ref.status, ref.json?.error?.message]).toEqual([
      503,
      "Chưa tra được Cục Thuế, thử lại sau ít phút",
    ]);
    await ok(call(c, P.hoa, "POST", "/companies", { name: "Không MST" }));
    const noTax = await call(c, P.hoa, "POST", `/companies/refresh?party=${enc("name:khong mst")}`);
    expect([noTax.status, noTax.json?.error?.message]).toEqual([409, "Công ty chưa có MST"]);
    expect((await call(c, P.an, "GET", "/companies")).json).toEqual([]);
  });

  it("NCC chỉ có báo giá vào danh bạ (created_from = quote), NCC đã có không bị đè", async () => {
    await pork();
    await ok(call(c, P.hoa, "POST", "/companies", { tax_id: "0322223333", name: "Tên Người Đặt" }));
    for (const s of ["Thực phẩm Hưng Phát", "thực phẩm sạch bình an"])
      await ok(
        call(c, P.hoa, "POST", "/prices/quotes", {
          product: PORK,
          supplier_name: s,
          price: 94_000,
          quoted_at: "2026-10-10",
        }),
      );
    const all: Json[] = await ok(call(c, P.lan, "GET", "/companies"));
    // sắp theo match_form(tên): "ten nguoi đat" < "thuc pham hung phat"
    expect(all.map((x: Json) => [x.party, x.name, x.created_from])).toEqual([
      ["tax:0322223333", "Tên Người Đặt", "manual"],
      ["name:thuc pham hung phat", "Thực phẩm Hưng Phát", "quote"],
    ]);
  });
});

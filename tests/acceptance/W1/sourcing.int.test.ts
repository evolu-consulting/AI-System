// W1 · "Mua hàng" (`GET /pack/contracts/sourcing`, `PUT /pack/contracts/sourcing/:contractId/:line`): nguồn tự chọn rẻ nhất / người chọn, lãi,
// rủi ro nguồn sắp hết hạn, phụ lục thay giá, luật thấy M1, quyền gói (viewer không đổi nguồn), cách ly tenant, đầu vào xấu không 5xx,
// số câu SQL cố định. Port `mgmt-app/api/tests/test_sourcing.py`.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  arrangeW1,
  type CtxN1,
  call,
  captureSql,
  d,
  type Json,
  P,
  priced,
  setVisibility,
  startHd1,
  T,
} from "./_support/w1";

let c: CtxN1;
beforeAll(async () => {
  c = await startHd1();
}, 120_000);
afterAll(async () => {
  await c?.stop();
});

const A4 = "Giấy A4";
type W = { s1: string; m1: string; m2: string };
async function world(
  o: { sale?: string | null; m1?: string | null; m2?: string | null; m2status?: string } = {},
): Promise<W> {
  await arrangeW1(c);
  const owner = (v: string | null | undefined) => (v === undefined ? {} : { owner: v });
  const m1 = await priced(c.sql, {
    partner: "NCC Một",
    tax: "0300000001",
    number: "M-1",
    items: [
      { name: A4, price: 50_000 },
      { name: "Bút", price: 8_000, unit: "hộp" },
    ],
    ...owner(o.m1),
  });
  const m2 = await priced(c.sql, {
    partner: "NCC Hai",
    tax: "0300000002",
    number: "M-2",
    items: [{ name: A4, price: 60_000 }],
    status: o.m2status ?? "active",
    ...owner(o.m2),
  });
  const s1 = await priced(c.sql, {
    sale: true,
    partner: "Khách An",
    tax: "0400000001",
    number: "S-1",
    items: [
      { name: A4, price: 80_000, qty: 10 },
      { name: "Dịch vụ giao", price: 100_000, qty: 1 },
    ],
    ...owner(o.sale),
  });
  return { s1, m1, m2 };
}
const get = (p = P.hoa, q = "") => call(c, p, "GET", `/sourcing${q}`);
const row = (r: { json: Json }, name: string) =>
  r.json.lines.find((l: { name: string }) => l.name === name);
const choicesN = async (): Promise<number | undefined> =>
  (await c.sql<{ n: number }[]>`select count(*)::int as n from contracts.sourcing_choices`)[0]?.n;
const choose = (p: typeof P.hoa, sale: string, line: number | string, body: unknown) =>
  call(c, p, "PUT", `/sourcing/${sale}/${line}`, body);

describe("W1 · báo cáo nguồn hàng", () => {
  it("mỗi dòng đang bán: nguồn tự chọn = giá mua rẻ nhất còn hiệu lực; lãi/đơn vị, %, theo số lượng; ứng viên đủ", async () => {
    const w = await world();
    const r = await get();
    expect(r.status).toBe(200);
    expect(r.json.lines).toHaveLength(2);
    expect(row(r, A4)).toMatchObject({
      contract_id: w.s1,
      number: "S-1",
      line: 0,
      price: 80_000,
      qty: 10,
      customer: { name: "Khách An" },
      source: {
        contract_id: w.m1,
        number: "M-1",
        price: 50_000,
        mode: "auto",
        supplier: { name: "NCC Một" },
      },
      margin: 30_000,
      profit: 300_000,
      risk: null,
    });
    expect(row(r, A4).margin_pct).toBeCloseTo(37.5);
    expect(r.json.candidates[row(r, A4).product].map((x: { price: number }) => x.price)).toEqual([
      50_000, 60_000,
    ]);
    // dịch vụ tự làm: không HĐ mua ⇒ không nguồn, không rủi ro
    expect(row(r, "Dịch vụ giao")).toMatchObject({
      source: null,
      margin: null,
      profit: null,
      risk: null,
    });
    expect(r.json.suppliers).toEqual([
      expect.objectContaining({
        supplier: expect.objectContaining({ name: "NCC Một" }),
        lines: 1,
        at_risk: 0,
        profit: 300_000,
        customers: ["Khách An"],
      }),
    ]);
    expect(r.json.truncated).toBe(false);
  });
  it("người chọn nguồn: đổi sang NCC Hai ⇒ chosen + lãi mới; chọn lại cùng nguồn vô hại; bỏ chọn (contract_id null) ⇒ về tự chọn", async () => {
    const w = await world();
    for (let i = 0; i < 2; i++) {
      const p = await choose(P.hoa, w.s1, 0, { contract_id: w.m2, line: 0 });
      expect([p.status, p.json]).toEqual([200, { ok: true }]);
    }
    expect(row(await get(), A4)).toMatchObject({
      source: { contract_id: w.m2, mode: "chosen" },
      margin: 20_000,
      profit: 200_000,
    });
    expect(await choicesN()).toBe(1);
    expect((await choose(P.hoa, w.s1, 0, { contract_id: null })).status).toBe(200);
    expect(row(await get(), A4)).toMatchObject({ source: { contract_id: w.m1, mode: "auto" } });
    expect((await choose(P.hoa, w.s1, 0, {})).status).toBe(200); // bỏ chọn khi chưa chọn: vô hại
  });
  it("rủi ro: nguồn sắp hết hạn (expiring) ⇒ source_expiring, nhà cung cấp đếm dòng rủi ro, rủi ro xếp trước; nguồn hết hiệu lực mà được chọn ⇒ source_ended", async () => {
    const w = await world({ m2status: "expiring" });
    await choose(P.hoa, w.s1, 0, { contract_id: w.m2, line: 0 });
    let r = await get();
    expect(r.json.lines[0]).toMatchObject({ name: A4, risk: "source_expiring" });
    expect(r.json.suppliers[0]).toMatchObject({ lines: 1, at_risk: 1 });
    await c.sql`update contracts.contracts set status = 'expired' where id = ${w.m2}`;
    r = await get();
    expect(row(r, A4)).toMatchObject({
      risk: "source_ended",
      source: { current: false, mode: "chosen" },
    });
  });
  it("lọc ?contract=: HĐ bán ⇒ dòng của nó; HĐ mua ⇒ các dòng bán mua từ nó; HĐ lạ ⇒ rỗng", async () => {
    const w = await world();
    expect((await get(P.hoa, `?contract=${w.s1}`)).json.lines).toHaveLength(2);
    expect(
      (await get(P.hoa, `?contract=${w.m1}`)).json.lines.map((l: { name: string }) => l.name),
    ).toEqual([A4]);
    expect((await get(P.hoa, `?contract=${w.m2}`)).json.lines).toEqual([]);
    expect((await get(P.hoa, `?contract=${crypto.randomUUID()}`)).json.lines).toEqual([]);
  });
  it("phụ lục có hiệu lực thay giá HĐ gốc: giá mua mới được dùng, giá cũ hết hiệu lực; HĐ chờ kiểm / bị từ chối không có mặt", async () => {
    const w = await world();
    const app = await priced(c.sql, {
      partner: "NCC Một",
      number: "M-1-PL1",
      parent: w.m1,
      effective: d(-1),
      items: [{ name: A4, price: 45_000 }],
    });
    await priced(c.sql, {
      partner: "NCC Ba",
      number: "M-3",
      items: [{ name: A4, price: 1_000 }],
      status: "needs_review",
    });
    await priced(c.sql, {
      partner: "NCC Tư",
      number: "M-4",
      items: [{ name: A4, price: 1_000 }],
      status: "rejected",
    });
    const r = await get();
    expect(row(r, A4)).toMatchObject({
      source: { contract_id: app, price: 45_000 },
      margin: 35_000,
    });
    const cands = r.json.candidates[row(r, A4).product] as {
      contract_id: string;
      price: number;
      current: boolean;
    }[];
    expect(cands.map((x) => [x.price, x.current])).toEqual([
      [45_000, true],
      [60_000, true],
      [50_000, false],
    ]);
  });
});

describe("W1 · luật thấy M1 (chế độ org)", () => {
  it("hoa chỉ thấy HĐ mình phụ trách: dòng bán của S-1 hiện nhưng nguồn mua của người khác không hiện; lan (owner) thấy tất cả", async () => {
    const w = await world({ sale: P.hoa.id, m1: P.lan.id, m2: P.lan.id });
    await setVisibility(c, "org");
    try {
      const h = await get(P.hoa);
      expect(h.json.lines).toHaveLength(2);
      expect(row(h, A4)).toMatchObject({ source: null, margin: null });
      expect(Object.values(h.json.candidates).flat()).toEqual([]);
      expect(h.json.suppliers).toEqual([]);
      // chọn nguồn mua mà mình không thấy ⇒ không phải ứng viên ⇒ 422, không ghi
      expect((await choose(P.hoa, w.s1, 0, { contract_id: w.m1, line: 0 })).json.error.code).toBe(
        "SOURCING_INVALID",
      );
      expect(row(await get(P.lan), A4)).toMatchObject({ source: { contract_id: w.m1 } });
      expect((await get(P.tam)).json.lines).toEqual([]);
    } finally {
      await setVisibility(c, "tenant");
    }
  });
  it("lạm dụng (A): thấy phụ lục nhưng KHÔNG thấy HĐ bán gốc ⇒ không dòng nào, không lộ khách/sản phẩm/số HĐ gốc", async () => {
    const w = await world({ sale: P.lan.id, m1: P.lan.id, m2: P.lan.id });
    const app = await priced(c.sql, {
      sale: true,
      partner: "Khách An",
      number: "S-1-PL1",
      parent: w.s1,
      effective: d(-1),
      items: [{ name: A4, price: 85_000 }],
      owner: P.hoa.id,
    });
    await setVisibility(c, "org");
    try {
      const h = await get(P.hoa);
      expect(h.status).toBe(200);
      expect([h.json.lines, h.json.suppliers, h.json.candidates, h.json.stats.lines]).toEqual([
        [],
        [],
        {},
        0,
      ]);
      expect((await get(P.hoa, `?contract=${app}`)).json.lines).toEqual([]);
      const text = JSON.stringify(h.json);
      for (const leak of ["Khách An", "S-1", w.s1, A4])
        expect({ leak, hit: text.includes(leak) }).toEqual({ leak, hit: false });
      // lan (owner) vẫn thấy giá phụ lục thay giá gốc
      expect(row(await get(P.lan), A4)).toMatchObject({ contract_id: app, price: 85_000 });
    } finally {
      await setVisibility(c, "tenant");
    }
  });
  it("lạm dụng (B): thấy HĐ gốc nhưng KHÔNG thấy phụ lục ⇒ dòng gốc vẫn hiện giá gốc (phụ lục ẩn không làm nó hết hiệu lực)", async () => {
    const w = await world({ sale: P.hoa.id, m1: P.hoa.id, m2: P.hoa.id });
    const app = await priced(c.sql, {
      sale: true,
      partner: "Khách An",
      number: "S-1-PL1",
      parent: w.s1,
      effective: d(-1),
      items: [{ name: A4, price: 85_000 }],
      owner: P.lan.id,
    });
    await setVisibility(c, "org");
    try {
      const h = await get(P.hoa);
      expect(row(h, A4)).toMatchObject({ contract_id: w.s1, price: 80_000, margin: 30_000 });
      expect(JSON.stringify(h.json).includes(app)).toBe(false);
      expect(JSON.stringify(h.json).includes("S-1-PL1")).toBe(false);
    } finally {
      await setVisibility(c, "tenant");
    }
  });
  it("lạm dụng: người không thấy HĐ nào (chế độ org) ⇒ không dòng nào dù bộ nhớ đệm đã nóng", async () => {
    await world({ sale: P.lan.id, m1: P.lan.id, m2: P.lan.id });
    await setVisibility(c, "org");
    try {
      expect((await get(P.lan)).json.lines).toHaveLength(2); // làm nóng bộ nhớ đệm
      const h = await get(P.hoa);
      expect([h.status, h.json.lines, h.json.suppliers, h.json.stats.lines]).toEqual([
        200,
        [],
        [],
        0,
      ]);
    } finally {
      await setVisibility(c, "tenant");
    }
  });
  it("đổi nguồn HĐ bán không thấy ⇒ 404 và không ghi gì", async () => {
    const w = await world({ sale: P.lan.id });
    await setVisibility(c, "org");
    try {
      expect((await choose(P.hoa, w.s1, 0, { contract_id: w.m1, line: 0 })).status).toBe(404);
      expect(await choicesN()).toBe(0);
    } finally {
      await setVisibility(c, "tenant");
    }
  });
});

describe("W1 · quyền gói, tenant, đầu vào xấu", () => {
  it("viewer: đọc 200; đổi nguồn 403 PACK_FORBIDDEN kể cả thân rác, không ghi gì; không Group ⇒ 403", async () => {
    const w = await world();
    expect((await get(P.tam)).status).toBe(200);
    for (const body of [{ contract_id: w.m2, line: 0 }, { garbage: true }, "x"]) {
      const r = await choose(P.tam, w.s1, 0, body);
      expect([r.status, r.json?.error?.code]).toEqual([403, "PACK_FORBIDDEN"]);
    }
    expect((await get(P.cuc)).status).toBe(403);
    expect(await choicesN()).toBe(0);
    expect((await fetch(`${c.hub.base}/pack/contracts/sourcing`)).status).toBe(401);
  });
  it("beta (tenant khác): đọc rỗng; đổi nguồn HĐ acme ⇒ 404; không đổi gì", async () => {
    const w = await world();
    const r = await get(P.an);
    expect([r.status, r.json.lines, r.json.suppliers]).toEqual([200, [], []]);
    expect((await choose(P.an, w.s1, 0, { contract_id: w.m1, line: 0 })).status).toBe(404);
    expect(await choicesN()).toBe(0);
  });
  it("nguồn không hợp lệ ⇒ 422 SOURCING_INVALID (sản phẩm khác, dòng không có, HĐ không có, thiếu line); HĐ/dòng bán không có ⇒ 404", async () => {
    const w = await world();
    const cases: [string, number | string, unknown, number, string?][] = [
      [w.s1, 0, { contract_id: w.m1, line: 1 }, 422, "SOURCING_INVALID"], // "Bút" ≠ "Giấy A4"
      [w.s1, 0, { contract_id: w.m1, line: 7 }, 422, "SOURCING_INVALID"],
      [w.s1, 0, { contract_id: crypto.randomUUID(), line: 0 }, 422, "SOURCING_INVALID"],
      [w.s1, 0, { contract_id: w.m1 }, 422, "SOURCING_INVALID"],
      [w.s1, 0, { contract_id: w.s1, line: 0 }, 422, "SOURCING_INVALID"], // dòng bán không phải nguồn mua
      [w.s1, 1, { contract_id: w.m1, line: 0 }, 422, "SOURCING_INVALID"], // "Dịch vụ giao": không có ứng viên
      [crypto.randomUUID(), 0, { contract_id: w.m1, line: 0 }, 404, "NOT_FOUND"],
      [w.s1, 99, { contract_id: w.m1, line: 0 }, 404, "NOT_FOUND"],
    ];
    for (const [id, line, body, status, code] of cases) {
      const r = await choose(P.hoa, id, line, body);
      expect({
        id: id === w.s1 ? "s1" : "x",
        line,
        body,
        status: r.status,
        code: r.json?.error?.code,
      }).toEqual({
        id: id === w.s1 ? "s1" : "x",
        line,
        body,
        status,
        code,
      });
    }
    expect(await choicesN()).toBe(0);
  });
  it("đầu vào xấu ⇒ 4xx rõ, KHÔNG BAO GIỜ 5xx: id/line sai dạng, line ngoài 0…9999, thân lạ/hỏng, query lạ, tenant_id trong thân", async () => {
    const w = await world();
    const ok = { contract_id: w.m1, line: 0 };
    const bad: [string, string, unknown][] = [
      ["GET", "/sourcing?contract=not-a-uuid", undefined],
      ["GET", "/sourcing?x=1", undefined],
      ["PUT", "/sourcing/not-a-uuid/0", ok],
      ["PUT", `/sourcing/${w.s1}/abc`, ok],
      ["PUT", `/sourcing/${w.s1}/-1`, ok],
      ["PUT", `/sourcing/${w.s1}/10000`, ok],
      ["PUT", `/sourcing/${w.s1}/99999999999999999999`, ok],
      ["PUT", `/sourcing/${w.s1}/0`, { ...ok, tenant_id: T.beta }],
      ["PUT", `/sourcing/${w.s1}/0`, { contract_id: "xyz", line: 0 }],
      ["PUT", `/sourcing/${w.s1}/0`, { contract_id: w.m1, line: -1 }],
      ["PUT", `/sourcing/${w.s1}/0`, { contract_id: w.m1, line: 1.5 }],
      ["PUT", `/sourcing/${w.s1}/0`, { contract_id: w.m1, line: 10000 }],
      ["PUT", `/sourcing/${w.s1}/0`, { contract_id: w.m1, line: "0" }],
    ];
    for (const [m, path, body] of bad) {
      const r = await call(c, P.hoa, m, path, body);
      expect({ m, path, body, status: r.status }).toEqual({ m, path, body, status: 400 });
    }
    const raw = await fetch(`${c.hub.base}/pack/contracts/sourcing/${w.s1}/0`, {
      method: "PUT",
      headers: {
        authorization: `Bearer ${await c.tok(P.hoa)}`,
        "content-type": "application/json",
      },
      body: "{hỏng",
    });
    expect(raw.status).toBe(400);
  });
});

describe("W1-NFR · số câu SQL cố định", () => {
  it("GET (bộ nhớ đệm trúng): 4 câu — phạm vi + dấu vân tay, phạm vi + id HĐ thấy — dù có 3 hay 300 HĐ; PUT: kiểm dòng (2) + đọc (4) + ghi (2); bỏ chọn: 4", async () => {
    const w = await world();
    await get(); // làm nóng bộ nhớ quyền gói
    const small = await captureSql(c, () => get());
    for (let i = 0; i < 150; i++) {
      await priced(c.sql, {
        partner: `NCC ${i}`,
        number: `X-${i}`,
        items: [
          { name: `Mặt hàng ${i % 20}`, price: 1_000 + i },
          { name: A4, price: 70_000 + i },
        ],
      });
      await priced(c.sql, {
        sale: true,
        partner: `Khách ${i}`,
        number: `Y-${i}`,
        items: [{ name: `Mặt hàng ${i % 20}`, price: 9_000 }],
      });
    }
    const miss = await captureSql(c, () => get()); // dữ liệu đổi ⇒ trượt: +3 (phạm vi + dấu vân tay + nạp)
    const big = await captureSql(c, () => get());
    expect(big.r.json.stats.lines).toBeGreaterThan(150);
    expect([small.queries.length, miss.queries.length, big.queries.length]).toEqual([4, 7, 4]);
    const put = await captureSql(c, () => choose(P.hoa, w.s1, 0, { contract_id: w.m2, line: 0 }));
    expect([put.r.status, put.queries.length]).toEqual([200, 8]);
    const del = await captureSql(c, () => choose(P.hoa, w.s1, 0, { contract_id: null }));
    expect([del.r.status, del.queries.length]).toEqual([200, 4]);
  });
});

describe("W1 · phân trang, tìm, lọc rủi ro (tính trong SQL)", () => {
  async function many(n: number) {
    await arrangeW1(c);
    await priced(c.sql, {
      partner: "NCC Một",
      tax: "0300000001",
      number: "M-1",
      status: "expiring",
      items: [{ name: "Giấy A4", price: 50_000 }],
    });
    for (let i = 0; i < n; i++)
      await priced(c.sql, {
        sale: true,
        partner: `Khách ${String(i).padStart(3, "0")}`,
        number: `S-${String(i).padStart(3, "0")}`,
        items: [{ name: i % 3 === 0 ? "Giấy A4" : `Mực in ${i}`, price: 80_000 + i }],
      });
  }
  it("trang, tổng, số liệu độc lập trang; trang cuối lẻ; vượt trang ⇒ rỗng", async () => {
    await many(120);
    const p1 = await get(P.hoa, "?page_size=50");
    expect([
      p1.json.page,
      p1.json.page_size,
      p1.json.total,
      p1.json.lines.length,
      p1.json.stats.lines,
    ]).toEqual([1, 50, 120, 50, 120]);
    const p3 = await get(P.hoa, "?page=3&page_size=50");
    expect([p3.json.lines.length, p3.json.stats.lines]).toEqual([20, 120]);
    expect((await get(P.hoa, "?page=9&page_size=50")).json.lines).toEqual([]);
    expect((await get(P.hoa)).json.page_size).toBe(50);
    const all = [
      ...(await get(P.hoa, "?page=1&page_size=100")).json.lines,
      ...(await get(P.hoa, "?page=2&page_size=100")).json.lines,
    ];
    expect(new Set(all.map((l: { number: string }) => l.number)).size).toBe(120); // không trùng, không sót
    // 40 dòng "Giấy A4" mua từ HĐ sắp hết hạn ⇒ có rủi ro, xếp trước; stats.at_risk đếm trên mọi dòng
    expect(p1.json.stats).toMatchObject({ sourced: 40, at_risk: 40 });
    expect(
      p1.json.lines
        .slice(0, 40)
        .every((l: { risk: string | null }) => l.risk === "source_expiring"),
    ).toBe(true);
  });
  it("tìm bỏ dấu + ký tự đặc biệt không phá câu; lọc rủi ro; ứng viên chỉ cho sản phẩm trong trang", async () => {
    await many(30);
    const q = async (s: string, extra = "") =>
      (await get(P.hoa, `?q=${encodeURIComponent(s)}${extra}`)).json;
    expect((await q("khach 007")).total).toBe(1);
    expect((await q("MỰC IN")).total).toBe(20);
    expect((await q("%")).total).toBe(0);
    expect((await q("_")).total).toBe(0);
    expect((await q("a'b\"; drop table")).total).toBe(0);
    expect((await q("giay", "&risk=1")).total).toBe(10);
    expect((await q("muc", "&risk=1")).total).toBe(0);
    const r = await get(P.hoa, "?risk=1&page_size=100");
    expect(Object.keys(r.json.candidates)).toHaveLength(1);
    const none = await get(P.hoa, "?q=muc+in&page_size=100");
    expect(none.json.candidates).toEqual({});
  });
  it("tham số xấu ⇒ 400, không 5xx", async () => {
    await many(1);
    for (const qs of [
      "page=0",
      "page=abc",
      "page=-1",
      "page=1.5",
      "page=9999999999",
      "page_size=0",
      "page_size=101",
      "risk=2",
      `q=${"x".repeat(101)}`,
    ]) {
      const r = await get(P.hoa, `?${qs}`);
      expect({ qs, status: r.status }).toEqual({ qs, status: 400 });
    }
  });
});

describe("W1 · bộ nhớ đệm dòng giá theo tenant (dấu vân tay) + luật thấy theo người xem", () => {
  it("đổi giá HĐ (version tăng) ⇒ lần đọc sau thấy ngay; đổi trạng thái ⇒ thấy; hai request liền nhau cùng kết quả", async () => {
    const w = await world();
    const a = await get();
    expect(row(a, A4).margin).toBe(30_000);
    expect((await get()).json).toEqual(a.json);
    await c.sql`update contracts.contract_items set unit_price = 40000 where contract_id = ${w.m1} and ord = 0`;
    await c.sql`update contracts.contracts set version = version + 1, updated_at = now() where id = ${w.m1}`;
    expect(row(await get(), A4)).toMatchObject({ margin: 40_000, source: { price: 40_000 } });
    await c.sql`update contracts.contracts set status = 'expired' where id = ${w.m1}`; // đổi trạng thái không đổi version
    expect(row(await get(), A4)).toMatchObject({ source: { contract_id: w.m2 } });
  });
  it("hai người xem chung một bộ nhớ đệm nhưng thấy khác nhau (chế độ org, xen kẽ); tenant khác không lẫn", async () => {
    const w = await world({ sale: P.hoa.id, m1: P.lan.id, m2: P.lan.id });
    await setVisibility(c, "org");
    try {
      for (let i = 0; i < 2; i++) {
        expect(row(await get(P.lan), A4)).toMatchObject({ source: { contract_id: w.m1 } });
        expect(row(await get(P.hoa), A4)).toMatchObject({ source: null });
        expect((await get(P.an)).json.lines).toEqual([]);
        expect((await get(P.tam)).json.lines).toEqual([]);
      }
    } finally {
      await setVisibility(c, "tenant");
    }
    expect(row(await get(P.hoa), A4)).toMatchObject({ source: { contract_id: w.m1 } });
  });
  it("lựa chọn nguồn của người khác (ghi thẳng bảng) ⇒ đọc sau thấy", async () => {
    const w = await world();
    await get();
    await c.sql`insert into contracts.sourcing_choices (tenant_id, sale_contract_id, sale_line, source_contract_id, source_line)
      values (${T.acme}, ${w.s1}, 0, ${w.m2}, 0)`;
    expect(row(await get(), A4)).toMatchObject({ source: { contract_id: w.m2, mode: "chosen" } });
  });
});

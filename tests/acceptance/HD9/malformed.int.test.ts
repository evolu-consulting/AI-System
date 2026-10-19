// HD9 review (M2, m1, m2) · luật "không đầu vào nào ra 500": bảng thân/tham số hỏng cho MỌI POST/GET có tham số của CKS ⇒ 4xx
// (400 VALIDATION có đúng trường khi sai kiểu/dạng), MST sai dạng không thành khoá khách, tệp có serial chứng thư quá dài ⇒ chỉ
// tệp đó `unreadable` (không 500 cả lô), ngày/giờ không có thật ⇒ 400.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { arrangeCks, type CtxN1, d, KBASE, kcall, P, startHd1, world } from "./_support/hd9";

let c: CtxN1;
beforeAll(async () => {
  c = await startHd1();
}, 60_000);
afterAll(async () => {
  await c?.stop();
});

const lot = { ca: "Viettel-CA", qty: 1, unit_cost: 1, bought_at: "2026-01-02", device: "token" };
const holder = { name: "A", device: "token" };

describe("HD9 · đầu vào hỏng ⇒ 4xx, không bao giờ 500", () => {
  it("bảng thân hỏng cho mọi POST JSON (+ query hỏng cho GET)", async () => {
    await arrangeCks(c);
    const w = await world(c);
    const ren = (await kcall(c, P.hoa, "POST", `/groups/${w.bv.contract_id}/renew`, {})).json;
    const sale = (o: Record<string, unknown>) => ({
      company_name: "X",
      lot_id: w.lot.id,
      price_each: 1,
      signed_at: d(0),
      valid_to: d(30),
      holders: [holder],
      ...o,
    });
    const cert = (o: Record<string, unknown>) => ({
      company_name: "X",
      ca: "FPT-CA",
      valid_to: d(30),
      ...o,
    });
    const cases: [string, unknown, number[]][] = [
      ["/lots", null, [400]],
      ["/lots", [], [400]],
      ["/lots", { ...lot, qty: "x" }, [400]],
      ["/lots", { ...lot, unit_cost: 1e20 }, [400]],
      ["/lots", { ...lot, bought_at: "2026-02-30" }, [400]],
      ["/lots", { ...lot, bought_at: "0000-01-01" }, [400]],
      ["/lots", { ...lot, supplier_tax_id: "0312/345" }, [400]],
      ["/lots", { ...lot, ca: "a\u0000b" }, [400]],
      ["/lots", { ...lot, label: "x".repeat(41) }, [400]],
      ["/sales", sale({ company_tax_id: "0312/345" }), [400]],
      ["/sales", sale({ company_tax_id: "abc" }), [400]],
      ["/sales", sale({ company_tax_id: "MST:0312340001" }), [400]],
      ["/sales", sale({ lot_id: "x" }), [400]],
      ["/sales", sale({ holders: [] }), [400]],
      ["/sales", sale({ holders: [{ ...holder, serial: "A".repeat(101) }] }), [400]],
      ["/sales", sale({ signed_at: "2026-13-01" }), [400]],
      ["/sales", sale({ valid_to: "9999-12-31" }), [400]],
      ["/sales", sale({ price_each: "1" }), [400]],
      ["/sales", sale({ lot_id: crypto.randomUUID() }), [404]],
      ["/certificates", cert({ company_tax_id: "0312.34" }), [400]],
      ["/certificates", cert({ valid_to: "2026-04-31" }), [400]],
      ["/certificates", cert({ serial: "\u0000" }), [400]],
      [`/groups/${w.bv.contract_id}/renew`, { remind_at: "2026-02-30T09:00" }, [400]],
      [`/groups/${w.ba.contract_id}/renew`, { remind_at: "2026-10-20T25:00" }, [400]],
      [`/groups/${w.ba.contract_id}/renew`, { remind_at: "2026-10-20T09:60" }, [400]],
      [`/groups/${w.ba.contract_id}/renew`, { years: 9 }, [400]],
      [`/groups/${w.ba.contract_id}/renew`, { price_each: -1 }, [400]],
      ["/groups/not-a-uuid/renew", {}, [400]],
      [`/renewals/${ren.id}/complete`, { serials: { x: "1" } }, [400]],
      [`/renewals/${ren.id}/complete`, { serials: {}, valid_to: "x" }, [400]],
      [`/renewals/${ren.id}/complete`, { serials: { [ren.certificate_ids[0]]: "a\u0000" } }, [400]],
      [
        `/renewals/${ren.id}/complete`,
        { serials: { [ren.certificate_ids[0]]: "x".repeat(101) } },
        [400],
      ],
      [`/renewals/${ren.id}/lost`, { reason: "" }, [400]],
      [`/renewals/${crypto.randomUUID()}/lost`, { reason: "x" }, [404]],
      [`/customers/${w.tt.company_id}/followups`, { at: "2026-02-30T10:00" }, [400]],
      [`/customers/${w.tt.company_id}/followups`, { at: "2026-10-20T24:00" }, [400]],
      [`/customers/${w.tt.company_id}/followups`, { at: "2026-10-20" }, [400]],
      [
        `/customers/${w.tt.company_id}/followups`,
        { at: "2026-10-20T10:00", note: "x".repeat(201) },
        [400],
      ],
      ["/scans", { years: 0, device: "token" }, [400]],
      ["/scans", { years: 1, device: "token" }, [503]],
    ];
    for (const [path, body, ok] of cases) {
      const r = await kcall(c, P.hoa, "POST", path, body);
      expect({ path, body, status: ok.includes(r.status) ? "ok" : r.status }).toEqual({
        path,
        body,
        status: "ok",
      });
    }
    for (const q of [
      "/customers?ca=%00",
      "/customers?q=%00x",
      "/customers?page=0",
      "/customers?page_size=1000",
      "/prices?filter=x",
    ]) {
      const r = await kcall(c, P.tam, "GET", q);
      expect({ q, status: r.status }).toEqual({ q, status: 400 });
    }
    // M2: không MST rác nào thành khách.
    const [n] =
      await c.sql`select count(*)::int as n from contracts.cks_customers where tax_id !~ '^[0-9]{10}([0-9]{2}|-[0-9]{3})?$'`;
    expect(n?.n).toBe(0);
  });
  it("M2 · MST hợp lệ viết kiểu khác (chấm, cách, 13 số liền) ⇒ cùng một khách đã chuẩn hoá", async () => {
    await arrangeCks(c);
    const add = (tax: string) =>
      kcall(c, P.hoa, "POST", "/certificates", {
        company_name: "Khách MST",
        company_tax_id: tax,
        ca: "FPT-CA",
        valid_to: d(30),
      });
    const a = await add("0312.340.001 002");
    const b = await add("0312340001-002");
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(a.json.company_id).toBe(b.json.company_id);
    const [row] =
      await c.sql`select tax_id from contracts.cks_customers where id = ${a.json.company_id}`;
    expect(row?.tax_id).toBe("0312340001-002");
  });
  it("m1 · tệp có serial chứng thư 60 byte ⇒ chỉ tệp đó unreadable; tệp hợp lệ cùng lô vẫn vào; tên tệp có NUL không làm 500", async () => {
    await arrangeCks(c);
    await world(c);
    const len = (n: number): number[] =>
      n < 0x80 ? [n] : n < 0x100 ? [0x81, n] : [0x82, n >> 8, n & 0xff];
    const tlv = (tag: number, body: number[]): number[] => [tag, ...len(body.length), ...body];
    const seq = (...xs: number[][]) => tlv(0x30, xs.flat());
    const cert = (serial: number[]) =>
      btoa(
        String.fromCharCode(...seq(seq(tlv(0x02, serial), seq(), seq()), seq(), tlv(0x03, [0]))),
      );
    const xml = (no: string, serial: number[]) =>
      `<HDon><SHDon>${no}</SHDon><NLap>2026-09-01</NLap><X509Certificate>${cert(serial)}</X509Certificate></HDon>`;
    const f = new FormData();
    f.append(
      "files",
      new File(
        [
          xml(
            "1",
            Array.from({ length: 60 }, () => 0xab),
          ),
        ],
        "dai.xml",
      ),
    );
    f.append(
      "files",
      new File([xml("2", [0x54, 0x01, 0x0b, 0x72, 0x33, 0xaf, 0x9e, 0x10])], "hop-le.xml"),
    );
    const r = await fetch(`${c.hub.base}${KBASE}/signed-docs/upload`, {
      method: "POST",
      headers: { authorization: `Bearer ${await c.tok(P.hoa)}` },
      body: f,
    });
    expect({ status: r.status, body: await r.json() }).toEqual({
      status: 200,
      body: { added: 1, skipped: 0, unmatched: 0, unreadable: 1 },
    });
    // Tên tệp có NUL: tuỳ cách mã hoá multipart, tệp vào được (NUL bị bỏ) hoặc thành `unreadable` (mất đuôi) — không bao giờ 500.
    const nul = new FormData();
    nul.append("files", new File([xml("3", [0x0c])], "a\u0000b.xml"));
    const rn = await fetch(`${c.hub.base}${KBASE}/signed-docs/upload`, {
      method: "POST",
      headers: { authorization: `Bearer ${await c.tok(P.hoa)}` },
      body: nul,
    });
    const nb = await rn.json();
    expect({ status: rn.status, files: nb.added + nb.unreadable }).toEqual({
      status: 200,
      files: 1,
    });
    const bad = await fetch(`${c.hub.base}${KBASE}/signed-docs/upload`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${await c.tok(P.hoa)}`,
        "content-type": "application/json",
      },
      body: "{}",
    });
    expect(bad.status).toBe(400);
  });
});

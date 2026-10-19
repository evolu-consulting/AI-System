// HD8-FR-01…04 · HD8-AC01…AC04 · HD8-NFR-02: đối tác + điểm uy tín + cách tính qua hub-api thật — parity NGUYÊN VĂN mgmt-app
// `tests/test_scoring_routes.py` (+ chấm tay `test_scoring_ratings.py`). Quyền: viewer chỉ đọc, editor ghi việc/chấm, chỉ owner
// (`admin`) lưu cách tính; tenant khác không thấy gì. Không đầu vào nào ra 500.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  ago,
  arrangeHd8,
  type CtxN1,
  call,
  deal,
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

const PN = "tax:0355555555";
const BV = "tax:0366666666";
const HH = "tax:0377777777";

/** `world` fixture của test_scoring_routes.py. */
async function world() {
  await arrangeHd8(c);
  await deal(c.sql, {
    sale: true,
    partner: "Kế toán Phương Nam",
    tax: "0355555555",
    number: "PN-1",
  });
  await deal(c.sql, { sale: true, partner: "Bếp Việt", tax: "0366666666", number: "BV-1" });
  await deal(c.sql, { sale: false, partner: "VPP Hồng Hà", tax: "0377777777", number: "HH-1" });
  for (let i = 0; i < 12; i++)
    await record(c.sql, T.acme, PN, "customer", "received", ago(15 + 28 * i), {
      days_late: i ? 0 : 4,
    });
  for (let i = 0; i < 8; i++)
    await record(c.sql, T.acme, BV, "customer", "received", ago(20 + 40 * i), {
      days_late: i % 2 ? 6 : 0,
    });
  for (let i = 0; i < 5; i++)
    await record(c.sql, T.acme, BV, "customer", "reminded", ago(10 + 30 * i));
  await record(c.sql, T.acme, HH, "supplier", "delivered", ago(5), { days_late: 0 });
}

describe("HD8-AC01 · đối tác được chấm từ sổ và nói vì sao (test_partners_are_scored_from_their_ledger_and_say_why)", () => {
  it("điểm, mức, lý do; lọc vai; điểm chi tiết; tenant khác rỗng", async () => {
    await world();
    const rows: Json[] = await ok(call(c, P.lan, "GET", "/partners"));
    const by = Object.fromEntries(rows.map((p: Json) => [p.name, p]));
    const pn = by["Kế toán Phương Nam"];
    const bv = by["Bếp Việt"];
    const hh = by["VPP Hồng Hà"];
    expect([pn.role, pn.band, pn.reason, pn.party]).toEqual([
      "customer",
      "good",
      "Thanh toán đúng hạn 11/12 đợt",
      PN,
    ]);
    expect(bv.score).toBeLessThan(pn.score);
    expect(bv.reason.startsWith("Phải nhắc thanh toán 5 lần")).toBe(true);
    expect([hh.score, hh.reason, hh.role]).toEqual([null, "Chưa đủ dữ liệu để chấm", "supplier"]);
    expect("breakdown" in pn).toBe(false);
    expect(rows.map((p: Json) => p.name)).toEqual([
      "Kế toán Phương Nam",
      "Bếp Việt",
      "VPP Hồng Hà",
    ]);
    const sup: Json[] = await ok(call(c, P.lan, "GET", "/partners?role=supplier"));
    expect(sup.map((p: Json) => p.name)).toEqual(["VPP Hồng Hà"]);
    const one = await ok(
      call(c, P.tam, "GET", `/partners/score?party=${encodeURIComponent(PN)}&role=customer`),
    );
    expect(one.breakdown.payment_on_time.detail).toBe("Thanh toán đúng hạn 11/12 đợt");
    expect(await ok(call(c, P.an, "GET", "/partners"))).toEqual([]);
    expect((await call(c, P.cuc, "GET", "/partners")).status).toBe(403);
  });

  it("đối tác vừa khách vừa NCC chỉ một dòng ở role=all (vai giao dịch nhiều hơn)", async () => {
    await arrangeHd8(c);
    await deal(c.sql, { sale: true, partner: "Hai Vai", tax: "0311110000" });
    await deal(c.sql, { sale: false, partner: "Hai Vai", tax: "0311110000" });
    await record(c.sql, T.acme, "tax:0311110000", "supplier", "delivered", ago(3), {
      days_late: 0,
    });
    const all: Json[] = await ok(call(c, P.lan, "GET", "/partners"));
    expect(all.map((p: Json) => [p.name, p.role, p.roles])).toEqual([
      ["Hai Vai", "supplier", ["customer", "supplier"]],
    ]);
  });
});

const body = (cfg: Json) => ({
  criteria: cfg.criteria.map((x: Json) => ({
    ...x,
    weight: x.weight + (x.key === "reminders" ? 5 : x.key === "tenure" ? -5 : 0),
  })),
  rules: cfg.rules,
});

describe("HD8-AC02 · chỉ quản lý lưu cách tính đúng 100%; xem trước không ghi (test_only_the_owner_saves…)", () => {
  it("xem trước, 403, 422 đúng chữ, lưu ⇒ version 1 + lịch sử; vai tách riêng; vai lạ 404", async () => {
    await world();
    const cfg = await ok(call(c, P.lan, "GET", "/scoring/customer"));
    expect(cfg.version).toBe(0);
    expect(cfg.criteria.reduce((s: number, x: Json) => s + x.weight, 0)).toBe(100);
    expect(cfg.manual_choices).toContain("Thái độ hợp tác");
    const b = body(cfg);
    const pv = await ok(call(c, P.lan, "POST", "/scoring/customer/preview", b));
    expect(pv.total).toBe(2);
    expect(pv.changes.some((x: Json) => x.name === "Bếp Việt" && x.new < x.old)).toBe(true);
    expect((await ok(call(c, P.lan, "GET", "/scoring/customer"))).version).toBe(0);
    expect((await call(c, P.hoa, "PUT", "/scoring/customer", b)).status).toBe(403);
    expect((await call(c, P.tam, "PUT", "/scoring/customer", b)).status).toBe(403);
    const bad = {
      ...b,
      criteria: b.criteria.map((x: Json, i: number) =>
        i === 0 ? { ...x, weight: x.weight + 1 } : x,
      ),
    };
    const r = await call(c, P.lan, "PUT", "/scoring/customer", bad);
    expect([r.status, r.json?.error?.message]).toEqual([422, "Tổng trọng số phải đúng 100%"]);
    const saved = await ok(call(c, P.lan, "PUT", "/scoring/customer", b));
    expect(saved.version).toBe(1);
    expect(saved.updated_by).toBeString();
    const hist: Json[] = await ok(call(c, P.tam, "GET", "/scoring/customer/history"));
    expect(hist[0].version).toBe(1);
    expect(hist[0].summary).toContain("Số lần phải nhắc 15→20%");
    expect((await ok(call(c, P.lan, "GET", "/scoring/supplier"))).version).toBe(0);
    expect((await call(c, P.lan, "GET", "/scoring/nobody")).status).toBe(404);
    const [snap] = await c.sql<
      { n: number }[]
    >`select count(*)::int as n from contracts.score_snapshots
      where tenant_id = ${T.acme} and role = 'customer' and config_version = 1`;
    expect(snap?.n).toBe(2);
  });
});

describe("HD8-AC03 · chấm tay theo tiêu chí tự chấm (test_scoring_ratings.py)", () => {
  it("thêm tiêu chí từ danh sách ⇒ editor chấm 0–100 ⇒ điểm tính; viewer 403; tiêu chí ngoài cách tính 422", async () => {
    await world();
    const cfg = await ok(call(c, P.lan, "GET", "/scoring/customer"));
    const criteria = [
      ...cfg.criteria.map((x: Json) => (x.key === "payment_on_time" ? { ...x, weight: 15 } : x)),
      { kind: "manual", label: "Thái độ hợp tác", enabled: true, weight: 20 },
    ];
    const saved = await ok(
      call(c, P.lan, "PUT", "/scoring/customer", { criteria, rules: cfg.rules }),
    );
    const key = saved.criteria.at(-1).key;
    expect(key).toBe("custom:thai-do-hop-tac");
    const free = await call(c, P.lan, "PUT", "/scoring/customer", {
      criteria: [
        ...criteria.slice(0, -1),
        { kind: "manual", label: "Tự đặt", enabled: true, weight: 20 },
      ],
      rules: cfg.rules,
    });
    expect([free.status, free.json?.error?.message]).toEqual([
      422,
      "Chọn tiêu chí tự chấm trong danh sách: Tự đặt không có",
    ]);
    const rate = { party: PN, role: "customer", criterion: key, value: 40, note: "chậm trả lời" };
    expect((await call(c, P.tam, "PUT", "/partners/ratings", rate)).status).toBe(403);
    const r1 = await ok(call(c, P.hoa, "PUT", "/partners/ratings", rate));
    expect([r1.value, r1.note]).toEqual([40, "chậm trả lời"]);
    const wrong = await call(c, P.hoa, "PUT", "/partners/ratings", {
      ...rate,
      criterion: "custom:x",
    });
    expect([wrong.status, wrong.json?.error?.message]).toEqual([
      422,
      "Tiêu chí không có trong cách tính điểm",
    ]);
    const ghost = await call(c, P.hoa, "PUT", "/partners/ratings", { ...rate, party: "tax:999" });
    expect(ghost.status).toBe(404);
    const rt = await ok(
      call(c, P.tam, "GET", `/partners/ratings?party=${encodeURIComponent(PN)}&role=customer`),
    );
    expect(rt.criteria[0]).toMatchObject({ key, label: "Thái độ hợp tác", weight: 20 });
    expect([rt.criteria[0].current.value, rt.criteria[0].current.counts]).toEqual([40, true]);
    expect(rt.history.length).toBe(1);
    const one = await ok(
      call(c, P.lan, "GET", `/partners/score?party=${encodeURIComponent(PN)}&role=customer`),
    );
    expect(one.breakdown[key].value).toBe(40);
    expect(
      (
        await call(
          c,
          P.an,
          "GET",
          `/partners/ratings?party=${encodeURIComponent(PN)}&role=customer`,
        )
      ).status,
    ).toBe(404);
  });
});

describe("HD8-NFR-02 · không đầu vào nào ra 500", () => {
  it("thân/tham số rác ⇒ 400/404/422, không 5xx", async () => {
    await world();
    const cases: [string, string, unknown?][] = [
      ["GET", "/partners?role=x"],
      ["GET", "/partners?role=customer&x=1"],
      ["GET", "/partners/score"],
      ["GET", "/partners/score?party=&role=customer"],
      ["GET", `/partners/score?party=${"x".repeat(301)}&role=customer`],
      ["GET", "/partners/score?party=tax%3A1&role=nope"],
      ["GET", "/partners/ratings?party=%00&role=customer"],
      ["PUT", "/partners/ratings", { party: PN, role: "customer", criterion: "x", value: 101 }],
      ["PUT", "/partners/ratings", { party: PN, role: "customer", criterion: "x", value: 1.5 }],
      ["PUT", "/partners/ratings", "not json"],
      ["POST", "/scoring/customer/preview", {}],
      ["POST", "/scoring/customer/preview", { criteria: "x", rules: {} }],
      ["POST", "/scoring/customer/preview", { criteria: [], rules: { good_from: 1e9 } }],
      [
        "POST",
        "/scoring/customer/preview",
        {
          criteria: [{ key: "payment_on_time", enabled: true, weight: 100 }],
          rules: {
            good_from: 0,
            fair_from: 0,
            min_events: -1,
            window_months: 0,
            recency_boost: true,
            recency_months: 0,
            manual_adjust: true,
          },
        },
      ],
      [
        "PUT",
        "/scoring/customer",
        { criteria: Array(51).fill({ enabled: true, weight: 1 }), rules: {} },
      ],
      ["GET", "/scoring/%E0%A4%A"],
      ["GET", "/prices/compare"],
      ["GET", `/prices/compare?product=${"p".repeat(601)}`],
      ["GET", "/prices/compare?product=name%3Akhong-co%7C"],
      [
        "POST",
        "/prices/quotes",
        { product: "x", supplier_name: "", price: 1, quoted_at: "2026-10-10" },
      ],
      [
        "POST",
        "/prices/quotes",
        { product: "x", supplier_name: "A", price: 0, quoted_at: "2026-10-10" },
      ],
      [
        "POST",
        "/prices/quotes",
        { product: "x", supplier_name: "A", price: 1e16, quoted_at: "2026-02-30" },
      ],
      [
        "POST",
        "/prices/quotes",
        {
          product: "x",
          supplier_name: "A",
          price: 1,
          quoted_at: "2026-10-10",
          url: "javascript:1",
        },
      ],
      ["DELETE", "/prices/quotes/not-a-uuid"],
      ["DELETE", `/prices/quotes/${crypto.randomUUID()}`],
    ];
    for (const [m, path, b] of cases) {
      const r = await call(c, P.lan, m, path, b);
      expect({ path, ok: r.status >= 400 && r.status < 500 }).toEqual({ path, ok: true });
    }
  });
});

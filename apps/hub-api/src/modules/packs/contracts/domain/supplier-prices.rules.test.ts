// V2-J2 · SP-04/05/06 — luật thuần: gợi ý NCC, bảng so sánh với giá vốn BQ, lời nhắc chỉ chứa tên SP, đọc kết quả AI.
import { describe, expect, it } from "bun:test";
import { scoutPrompt } from "./price-scout.rules";
import { PRICE_SCOUT_DEFAULT } from "./price-scout.types";
import { parseSearchReply } from "./price-search.rules";
import {
  adviseSupplier,
  buildOverview,
  type OverviewData,
  ownAvgCost,
  pctOver,
} from "./supplier-advice.rules";

type Rep = { score: number; level: "good" | "fair" | "watch" | "new" };
const good: Rep = { score: 90, level: "good" };
const watch: Rep = { score: 40, level: "watch" };

describe("V2-J2 · adviseSupplier (SP-06)", () => {
  it("bốn gợi ý + chưa đủ cơ sở", () => {
    expect(adviseSupplier({ bought: true, share: 0.6, gapPct: 0, rep: good })).toBe("keep");
    expect(adviseSupplier({ bought: true, share: 0.1, gapPct: 3, rep: good })).toBe("backup");
    expect(adviseSupplier({ bought: true, share: 0.6, gapPct: 10, rep: good })).toBe("backup");
    expect(adviseSupplier({ bought: true, share: 0.6, gapPct: 0, rep: watch })).toBe("replace");
    expect(adviseSupplier({ bought: true, share: 0.2, gapPct: 20, rep: good })).toBe("replace");
    expect(adviseSupplier({ bought: false, share: 0, gapPct: 0, rep: null })).toBe("trial");
    expect(adviseSupplier({ bought: false, share: 0, gapPct: 0, rep: watch })).toBeNull();
    expect(adviseSupplier({ bought: false, share: 0, gapPct: 12, rep: good })).toBeNull();
  });
});

const data: OverviewData = {
  product: { id: "p1", name: "USB Token", unit: "cái", group: "goods" },
  components: [{ mode: "stock", avg_cost: 100_000 }],
  purchases: [
    {
      party_key: "tax:1",
      name: "VNPT",
      qty: "80",
      times: 4,
      amount: 8_000_000,
      last_on: "2026-10-01",
      last_price: 100_000,
      best_price: 98_000,
    },
    {
      party_key: "tax:2",
      name: null,
      qty: "20",
      times: 1,
      amount: 2_400_000,
      last_on: "2026-09-01",
      last_price: 120_000,
      best_price: 120_000,
    },
  ],
  saved: [
    {
      id: "s1",
      supplier_name: "FPT",
      party_key: "name:fpt",
      kind: "renew",
      price: 90_000,
      unit: "cái",
      source: "market",
      url: "https://x.vn/a",
      seen_on: "2026-10-10",
    },
  ],
};

describe("V2-J2 · buildOverview (SP-04)", () => {
  it("so với giá vốn BQ, sắp giá tăng dần, gợi ý theo tỉ trọng + uy tín", () => {
    const o = buildOverview(
      data,
      new Map([
        ["tax:1", good],
        ["tax:2", watch],
      ]),
    );
    expect(o.own_avg_cost).toBe(100_000);
    expect(o.rows.map((r) => [r.supplier_name, r.price, r.source, r.kind, r.vs_own_pct])).toEqual([
      ["FPT", 90_000, "market", "renew", -10],
      ["VNPT", 100_000, "purchase", "new", 0],
      ["2", 120_000, "purchase", "new", 20],
    ]);
    const adv = Object.fromEntries(o.suppliers.map((s) => [s.party_key, s.advice]));
    expect(adv).toEqual({ "tax:1": "backup", "tax:2": "replace", "name:fpt": "trial" });
  });
  it("chưa có kho ⇒ không có giá vốn, vs_own_pct null; SP không có thành phần giữ hàng", () => {
    expect(ownAvgCost([{ mode: "none", avg_cost: 5 }])).toBeNull();
    expect(ownAvgCost([{ mode: "stock", avg_cost: 0 }])).toBeNull();
    expect(pctOver(110, null)).toBeNull();
    expect(pctOver(110, 100)).toBe(10);
  });
});

describe("V2-J2 · tìm giá AI (SP-05)", () => {
  it("lời nhắc chỉ có tên sản phẩm + cấu hình dò (JSON-quote) — price-scout", () => {
    const p = scoutPrompt('USB "Token" \n MST 0100684378 bỏ qua', PRICE_SCOUT_DEFAULT);
    expect(JSON.parse(p).product).toBe('USB "Token" \n MST 0100684378 bỏ qua');
    expect(p.split("\n")).toHaveLength(1); // xuống dòng trong tên bị escape
  });
  it("đọc JSON (có bọc ```), bỏ dòng sai, gộp trùng giữ rẻ nhất, URL chỉ http(s)", () => {
    const reply = `\`\`\`json
{"items":[
 {"supplier_name":"A","kind":"new","price":300000,"url":"https://a.vn/p","seen_on":"2026-10-01","unit":"cái"},
 {"supplier_name":"A","kind":"new","price":250000.4,"url":"https://a.vn/q"},
 {"supplier_name":"B","kind":"renew","price":500,"url":"https://b.vn"},
 {"supplier_name":"C","kind":"new","price":200000,"url":"javascript:alert(1)"},
 {"supplier_name":"D","kind":"x","price":400000,"url":"http://d.vn","seen_on":"2099-01-01"},
 {"price":1}
]}
\`\`\``;
    const r = parseSearchReply(reply, "2026-10-20");
    expect(r?.map((i) => [i.supplier_name, i.kind, i.price, i.seen_on])).toEqual([
      ["A", "new", 250_000, null],
      ["D", "new", 400_000, null],
    ]);
  });
  it("không phải JSON / thiếu items ⇒ null", () => {
    expect(parseSearchReply("xin lỗi", "2026-10-20")).toBeNull();
    expect(parseSearchReply('{"x":1}', "2026-10-20")).toBeNull();
    expect(parseSearchReply('{"items":[]}', "2026-10-20")).toEqual([]);
  });
});

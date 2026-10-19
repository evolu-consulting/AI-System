// HD8-FR-05 · HD8-FR-06 · parity `test_scoring_ratings.py` L106-110 (chênh giá NCC) + `test_prices.py` L42-48 (so giá: HĐ trước,
// báo giá NCC mới "MỚI", báo giá mới hơn thay) + giá đang áp dụng theo phụ lục / trạng thái HĐ (`products.lines`).
import { describe, expect, test } from "bun:test";
import type { PriceItem } from "./appendix-pricing.rules";
import {
  compareGoods,
  type PricedContract,
  priceGaps,
  priceLines,
  productList,
  type Quote,
} from "./goods-prices.rules";

const TODAY = "2026-10-20";
const item = (name: string, unit_price: number | null, o: Partial<PriceItem> = {}): PriceItem => ({
  code: null,
  name,
  spec: null,
  unit: "kg",
  qty: null,
  unit_price,
  vat_rate: null,
  valid_from: null,
  valid_to: null,
  ...o,
});
const buy = (
  id: string,
  party: string,
  items: PriceItem[],
  o: Partial<PricedContract> = {},
): PricedContract => ({
  id,
  kind: "contract",
  status: "active",
  parent: null,
  direction: "purchase",
  party,
  party_name: party,
  title: id,
  eff: null,
  items,
  ...o,
});
const quote = (o: Partial<Quote>): Quote => ({
  id: "q1",
  product_key: "name:thit heo|",
  product_name: "Thịt heo",
  unit: "kg",
  supplier_name: "Hưng Phát",
  supplier_party_key: "name:hung phat",
  price: 94_500,
  quoted_at: "2026-10-10",
  source: "quote",
  url: null,
  ...o,
});

describe("chênh giá NCC (_price_gaps)", () => {
  test("heo 100.000 vs 110.000 ⇒ rẻ 0%, đắt 10%; một người bán ⇒ không có", () => {
    const lines = priceLines(
      [
        buy("a", "tax:1", [item("Thịt heo", 100_000), item("Gạo", 20_000)]),
        buy("b", "tax:2", [item("Thịt heo", 110_000)]),
      ],
      TODAY,
    );
    const g = priceGaps(lines, []);
    expect([g.get("tax:1"), g.get("tax:2")]).toEqual([0, 10]);
  });
  test("báo giá của NCC chưa có giá HĐ tính vào nơi rẻ nhất; HĐ hết hiệu lực / bị phụ lục thay không tính", () => {
    const lines = priceLines(
      [
        buy("a", "tax:1", [item("Thịt heo", 100_000)]),
        buy("old", "tax:3", [item("Thịt heo", 50_000)], { status: "expired" }),
        buy("p", "tax:4", [item("Thịt heo", 40_000)]),
        buy("ap", "tax:4", [item("Thịt heo", 120_000)], {
          kind: "appendix",
          parent: "p",
          eff: "2026-01-01",
        }),
      ],
      TODAY,
    );
    const g = priceGaps(lines, [quote({ price: 80_000 })]);
    expect(g.get("tax:1")).toBe(25); // 100.000 so 80.000 (báo giá)
    expect(g.get("tax:4")).toBe(50); // 120.000 (phụ lục) so 80.000
    expect(g.has("tax:3")).toBe(false);
  });
});

describe("so giá một mặt hàng (test_prices.py)", () => {
  const lines = priceLines(
    [buy("th", "tax:0322223333", [item("Thịt heo", 98_000)], { party_name: "Bình An" })],
    TODAY,
  );
  const scores = new Map([["tax:0322223333", { score: 90, band: "good" }]]);
  test("giá HĐ trước, báo giá NCC mới «MỚI»; báo giá mới hơn của cùng NCC thay báo giá cũ", () => {
    const r = compareGoods(lines, [quote({})], "name:thit heo|", scores);
    expect(r.rows.map((x) => [x.supplier, x.price, x.source.type, x.is_new, x.score])).toEqual([
      ["Bình An", 98_000, "contract", false, 90],
      ["Hưng Phát", 94_500, "quote", true, null],
    ]);
    const again = compareGoods(
      lines,
      [quote({}), quote({ id: "q2", price: 94_000, quoted_at: "2026-10-12" })],
      "name:thit heo|",
      scores,
    );
    expect(again.rows.map((x) => x.price)).toEqual([98_000, 94_000]);
    expect([r.product, r.market]).toEqual([
      { key: "name:thit heo|", label: "Thịt heo", unit: "kg" },
      { status: "tbd" },
    ]);
  });
  test("danh sách mặt hàng: dòng mua + báo giá, nhiều NCC trước, nhãn «tên (đ/đơn vị)»", () => {
    const got = productList(lines, [
      quote({}),
      quote({ product_key: "name:gao|", product_name: "Gạo", unit: null }),
    ]);
    expect(got).toEqual([
      { key: "name:thit heo|", label: "Thịt heo (đ/kg)", unit: "kg" },
      { key: "name:gao|", label: "Gạo", unit: null },
    ]);
  });
});

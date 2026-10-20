// W1 · "Mua hàng" (review B #9, #18): luật thấy áp lên dữ liệu THÔ trước khi dựng dòng giá; tiền làm tròn về đồng, giá vượt trần bỏ.
import { describe, expect, it } from "bun:test";
import {
  PRICE_MAX,
  type RawContract,
  type RawItem,
  type RawSourcing,
  salesOf,
  visibleTo,
} from "./sourcing.rules";

const TODAY = "2026-10-20";
const item = (name: string, price: number | null, o: Partial<RawItem> = {}): RawItem => ({
  ord: 0,
  code: null,
  name,
  spec: null,
  unit: "ram",
  qty: 10,
  unit_price: price,
  vat_rate: null,
  valid_from: null,
  valid_to: null,
  ...o,
});
const con = (id: string, o: Partial<RawContract> & { items: RawItem[] }): RawContract => ({
  id,
  kind: "contract",
  parent_id: null,
  title: "HĐ",
  number: id,
  status: "active",
  direction: "purchase",
  end_date: "2027-01-01",
  effective_date: null,
  seller: { key: "tax:1", name: "NCC 1" },
  buyer: { key: "tax:0", name: "Chúng tôi" },
  ...o,
});
const SALE = { direction: "sale" as const, buyer: { key: "tax:9", name: "Khách Ẩn" } };
const raw = (contracts: RawContract[]): RawSourcing => ({
  contracts,
  choices: [],
  truncated: false,
});

describe("W1 · luật thấy trước dòng giá (review B #9)", () => {
  const parent = con("S", { ...SALE, items: [item("A4", 80)] });
  const app = con("S-PL", {
    kind: "appendix",
    parent_id: "S",
    direction: null,
    effective_date: "2026-10-01",
    items: [item("A4", 85)],
  });
  const all = raw([parent, app]);

  it("thấy cả hai ⇒ giá phụ lục thay giá gốc", () => {
    expect(
      salesOf(visibleTo(all, ["S", "S-PL"]), TODAY).map((r) => [r.contract_id, r.price]),
    ).toEqual([["S-PL", 85]]);
  });
  it("(A) thấy phụ lục, không thấy HĐ gốc ⇒ phụ lục mồ côi bị bỏ: không dòng, không lộ khách của HĐ gốc", () => {
    const rows = salesOf(visibleTo(all, ["S-PL"]), TODAY);
    expect(rows).toEqual([]);
  });
  it("(B) thấy HĐ gốc, không thấy phụ lục ⇒ dòng gốc còn hiệu lực với giá gốc", () => {
    expect(salesOf(visibleTo(all, ["S"]), TODAY).map((r) => [r.contract_id, r.price])).toEqual([
      ["S", 80],
    ]);
  });
  it("không thấy gì ⇒ rỗng; lựa chọn nguồn chỉ giữ khi thấy cả dòng bán lẫn nguồn", () => {
    expect(salesOf(visibleTo(all, []), TODAY)).toEqual([]);
    const choices = [
      { sale_contract_id: "S", sale_line: 0, source_contract_id: "M", source_line: 0 },
      { sale_contract_id: "S", sale_line: 1, source_contract_id: "X", source_line: 0 },
    ];
    expect(visibleTo({ ...all, choices }, ["S", "M"]).choices).toEqual([choices[0]]);
  });
});

describe("W1 · tiền (review B #18)", () => {
  const sale = (price: number, qty: number | null) =>
    con("S", { ...SALE, items: [item("A4", price, { qty })] });
  it("lãi theo số lượng lẻ làm tròn về đồng; % làm tròn 2 chữ số", () => {
    const [r] = salesOf(raw([sale(1000, 0.333), con("M", { items: [item("A4", 667)] })]), TODAY);
    expect([r?.margin, r?.profit, r?.margin_pct]).toEqual([333, 111, 33.3]);
  });
  it("giá vượt trần 10^15 ⇒ không tính lãi (không báo số sai)", () => {
    const [r] = salesOf(
      raw([sale(PRICE_MAX * 10, 1), con("M", { items: [item("A4", 1)] })]),
      TODAY,
    );
    expect([r?.margin, r?.profit, r?.margin_pct]).toEqual([null, null, null]);
  });
  it("lãi × số lượng vượt số nguyên an toàn ⇒ null", () => {
    const [r] = salesOf(
      raw([sale(PRICE_MAX, 1_000_000), con("M", { items: [item("A4", 0)] })]),
      TODAY,
    );
    expect([r?.margin, r?.profit]).toEqual([PRICE_MAX, null]);
  });
});

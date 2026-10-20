// W1 · "Mua hàng": luật thuần (port `contracts/products.py::lines` + `sourcing.py`) — dòng giá có phụ lục, nguồn tự chọn/người chọn,
// lãi, rủi ro, nhà cung cấp.
import { describe, expect, it } from "bun:test";
import { SOURCING_CANDIDATES_MAX } from "@ai/contracts";
import {
  bySupplier,
  isCandidate,
  priceLines,
  type RawContract,
  type RawItem,
  report,
  sales,
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
let n = 0;
const con = (o: Partial<RawContract> & { items: RawItem[] }): RawContract => ({
  id: `c${String(++n).padStart(3, "0")}`,
  kind: "contract",
  parent_id: null,
  title: "HĐ",
  number: null,
  status: "active",
  direction: "purchase",
  end_date: "2027-01-01",
  effective_date: null,
  seller: { key: "tax:1", name: "NCC 1" },
  buyer: { key: "tax:0", name: "Chúng tôi" },
  ...o,
});
const sale = (items: RawItem[], o: Partial<RawContract> = {}) =>
  con({
    direction: "sale",
    seller: { key: "tax:0", name: "Chúng tôi" },
    buyer: { key: "tax:9", name: "Khách" },
    ...o,
    items,
  });
const buy = (items: RawItem[], o: Partial<RawContract> = {}) => con({ ...o, items });

describe("W1 · dòng giá", () => {
  it("vai theo hướng HĐ; hướng không rõ coi như mua; bên đối diện là đối tác", () => {
    const lines = priceLines(
      [sale([item("A", 80)]), buy([item("A", 50)]), buy([item("B", 5)], { direction: null })],
      TODAY,
    );
    expect(lines.map((l) => [l.role, l.party.name])).toEqual([
      ["customer", "Khách"],
      ["supplier", "NCC 1"],
      ["supplier", "NCC 1"],
    ]);
  });
  it("`current` theo ngày hiệu lực và trạng thái HĐ còn sống (hết hạn/chấm dứt ⇒ không áp dụng)", () => {
    const [a, b, c, d] = priceLines(
      [
        buy([item("A", 1)]),
        buy([item("A", 2)], { status: "expired" }),
        buy([item("A", 3, { valid_from: "2026-11-01" })]),
        buy([item("A", 4, { valid_to: "2026-10-19" })]),
      ],
      TODAY,
    );
    expect([a?.current, b?.current, c?.current, d?.current]).toEqual([true, false, false, false]);
  });
  it("phụ lục có hiệu lực thay giá HĐ gốc từ ngày đó (dòng cũ hết hiệu lực hôm trước); bên/hướng lấy của HĐ gốc", () => {
    const parent = buy([item("A", 50)], { id: "p1" });
    const app = con({
      id: "a1",
      kind: "appendix",
      parent_id: "p1",
      direction: null,
      seller: { key: null, name: null },
      buyer: { key: null, name: null },
      effective_date: "2026-10-01",
      items: [item("A", 45)],
    });
    const lines = priceLines([parent, app], TODAY);
    expect(lines.map((l) => [l.contract_id, l.price, l.current, l.role, l.party.name])).toEqual([
      ["p1", 50, false, "supplier", "NCC 1"],
      ["a1", 45, true, "supplier", "NCC 1"],
    ]);
  });
});

describe("W1 · dòng giá (phụ lục mồ côi, line)", () => {
  it("phụ lục mồ côi (HĐ gốc không có trong tập: không thấy/chưa duyệt) bị bỏ", () => {
    const orphan = con({ kind: "appendix", parent_id: "ghost", items: [item("A", 1)] });
    expect(priceLines([orphan], TODAY)).toEqual([]);
  });
  it("`line` = ord của dòng trong HĐ chứa nó (không phải chỉ số mảng)", () => {
    const [l] = priceLines([buy([item("A", 1, { ord: 7 })])], TODAY);
    expect(l?.line).toBe(7);
  });
});

describe("W1 · sales: nguồn, lãi, rủi ro", () => {
  it("tự chọn: giá mua rẻ nhất còn hiệu lực cùng đơn vị; lãi = bán − mua, % và theo số lượng", () => {
    const rows = sales(
      priceLines(
        [
          sale([item("A", 80, { qty: 10 })]),
          buy([item("A", 60)], { seller: { key: "tax:2", name: "NCC 2" } }),
          buy([item("A", 50)]),
        ],
        TODAY,
      ),
      [],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      margin: 30,
      profit: 300,
      risk: null,
      source: { mode: "auto", price: 50, supplier: { name: "NCC 1" } },
    });
    expect(rows[0]?.margin_pct).toBeCloseTo(37.5);
    expect(rows[0]?.cands.map((c) => c.price)).toEqual([50, 60]);
  });
  it("người chọn nguồn thắng giá rẻ nhất; chọn nguồn không còn là ứng viên ⇒ về tự chọn", () => {
    const lines = priceLines(
      [
        sale([item("A", 80)], { id: "s1" }),
        buy([item("A", 60)], { id: "b2" }),
        buy([item("A", 50)], { id: "b1" }),
      ],
      TODAY,
    );
    const pick = (src: string) => [
      { sale_contract_id: "s1", sale_line: 0, source_contract_id: src, source_line: 0 },
    ];
    expect(sales(lines, pick("b2"))[0]?.source).toMatchObject({ mode: "chosen", price: 60 });
    expect(sales(lines, pick("gone"))[0]?.source).toMatchObject({ mode: "auto", price: 50 });
  });
});

describe("W1 · sales: nguồn, lãi, rủi ro (đơn vị, rủi ro)", () => {
  it("khác đơn vị ⇒ không có lãi; không có HĐ mua ⇒ không nguồn, không rủi ro (dịch vụ tự làm)", () => {
    const [a] = sales(
      priceLines(
        [sale([item("A", 80, { unit: "hộp" })]), buy([item("A", 50, { unit: "ram" })])],
        TODAY,
      ),
      [],
    );
    expect(a?.source).toBeNull(); // tự chọn chỉ nhận cùng đơn vị
    const [b] = sales(priceLines([sale([item("Dịch vụ", 80)])], TODAY), []);
    expect(b).toMatchObject({ source: null, margin: null, profit: null, risk: null });
  });
  it("rủi ro: nguồn đang `expiring` ⇒ source_expiring; nguồn đã hết hiệu lực mà vẫn được chọn ⇒ source_ended; rủi ro xếp trước", () => {
    const lines = priceLines(
      [
        sale([item("A", 80)], { id: "s1", number: "S-2" }),
        sale([item("B", 80)], { id: "s2", number: "S-1" }),
        sale([item("C", 80)], { id: "s3", number: "S-0" }),
        buy([item("A", 50)], { status: "expiring" }),
        buy([item("B", 50)], { id: "bx", status: "expired" }),
        buy([item("C", 50)]),
      ],
      TODAY,
    );
    const rows = sales(lines, [
      { sale_contract_id: "s2", sale_line: 0, source_contract_id: "bx", source_line: 0 },
    ]);
    expect(rows.map((r) => [r.number, r.risk])).toEqual([
      ["S-1", "source_ended"], // rủi ro trước, cùng nhóm theo số HĐ
      ["S-2", "source_expiring"],
      ["S-0", null],
    ]);
  });
  it("chỉ dòng bán đang áp dụng; hợp đồng bán đã hết hạn không có mặt", () => {
    expect(sales(priceLines([sale([item("A", 80)], { status: "expired" })], TODAY), [])).toEqual(
      [],
    );
  });
});

const lines = priceLines(
  [
    sale([item("A", 80)], { id: "s1" }),
    sale([item("B", 90)], { id: "s2", buyer: { key: "tax:8", name: "Khách 2" } }),
    buy([item("A", 50), item("B", 40, { ord: 1 })], { status: "expiring" }),
  ],
  TODAY,
);

describe("W1 · bySupplier và report", () => {
  it("gom theo nhà cung cấp: số dòng, khách, dòng rủi ro, tổng lãi; rủi ro nhiều xếp trước", () => {
    const [s] = bySupplier(sales(lines, []));
    expect(s).toMatchObject({ lines: 2, at_risk: 2, profit: 30 * 10 + 50 * 10 });
    expect(s?.customers).toEqual(["Khách", "Khách 2"]);
  });
  it("report lọc theo HĐ: HĐ bán ⇒ dòng của nó; HĐ mua ⇒ các dòng bán mua từ nó", () => {
    const raw = {
      contracts: [
        sale([item("A", 80)], { id: "s1" }),
        buy([item("A", 50)], { id: "b1" }),
        sale([item("A", 70)], { id: "s9" }),
      ],
      choices: [],
      truncated: false,
    };
    expect(report(raw, TODAY, { contract: "s1" }).lines.map((l) => l.contract_id)).toEqual(["s1"]);
    expect(
      report(raw, TODAY, { contract: "b1" })
        .lines.map((l) => l.contract_id)
        .sort(),
    ).toEqual(["s1", "s9"]);
    expect(report(raw, TODAY, { contract: "none" }).lines).toEqual([]);
  });
});

describe("W1 · bySupplier và report (ứng viên)", () => {
  it("ứng viên bị cắt ở SOURCING_CANDIDATES_MAX nhưng nguồn đang dùng vẫn nằm trong danh sách", () => {
    const buys = Array.from({ length: SOURCING_CANDIDATES_MAX + 5 }, (_, i) =>
      buy([item("A", 100 + i)], { id: `b${String(i).padStart(2, "0")}` }),
    );
    const raw = {
      contracts: [sale([item("A", 500)], { id: "s1" }), ...buys],
      choices: [
        { sale_contract_id: "s1", sale_line: 0, source_contract_id: "b24", source_line: 0 },
      ],
      truncated: false,
    };
    const out = report(raw, TODAY);
    const [r] = out.lines;
    const cands = out.candidates[r?.product ?? ""] ?? [];
    expect(cands).toHaveLength(SOURCING_CANDIDATES_MAX + 1);
    expect(cands.some((c) => c.contract_id === "b24")).toBe(true);
    expect(r?.source).toMatchObject({ contract_id: "b24", mode: "chosen" });
  });
  it("isCandidate: chỉ dòng giá mua của cùng sản phẩm; dòng bán không tồn tại ⇒ false", () => {
    const all = sales(lines, []);
    const sale1 = {
      contract_id: lines.find((l) => l.role === "customer")?.contract_id as string,
      line: 0,
    };
    const b = lines.find((l) => l.role === "supplier") as { contract_id: string };
    expect(isCandidate(all, sale1, { contract_id: b.contract_id, line: 0 })).toBe(true);
    expect(isCandidate(all, sale1, { contract_id: b.contract_id, line: 1 })).toBe(false); // sản phẩm B ≠ A
    expect(
      isCandidate(all, { contract_id: "none", line: 0 }, { contract_id: b.contract_id, line: 0 }),
    ).toBe(false);
  });
});

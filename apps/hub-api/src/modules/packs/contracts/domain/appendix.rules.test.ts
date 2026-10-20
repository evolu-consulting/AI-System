// HD-FR-54 · HD-FR-55 · HD5: áp giá phụ lục (thuần) + gợi ý HĐ gốc (thuần).
import { describe, expect, it } from "bun:test";
import {
  applyAppendixPricing,
  dayBefore,
  type PriceItem,
  productKey,
} from "./appendix-pricing.rules";
import { citedNumber, suggestParents } from "./parent-suggest.rules";

const item = (o: Partial<PriceItem> & { name: string }): PriceItem => ({
  code: null,
  spec: null,
  unit: "cái",
  qty: 1,
  unit_price: 100,
  vat_rate: null,
  valid_from: null,
  valid_to: null,
  ...o,
});
const P = { id: "p", kind: "contract" as const, title: "HĐ gốc", effective_date: null };
const A = (id: string, eff: string | null, items: PriceItem[]) => ({
  id,
  kind: "appendix" as const,
  title: `PL ${id}`,
  effective_date: eff,
  items,
});

describe("applyAppendixPricing", () => {
  it("giá phụ lục thay giá gốc từ ngày hiệu lực: dòng cũ hết hạn ngày trước, dòng mới từ ngày đó", () => {
    const lines = applyAppendixPricing(
      { ...P, items: [item({ code: "A1", name: "Thùng", unit_price: 100 })] },
      [A("a1", "2026-07-01", [item({ code: "a1", name: "Thùng", unit_price: 120 })])],
      "2026-08-01",
    );
    expect(
      lines.map((l) => [l.source.id, l.valid_from, l.valid_to, l.superseded_by, l.current]),
    ).toEqual([
      ["p", null, "2026-06-30", "a1", false],
      ["a1", "2026-07-01", null, null, true],
    ]);
  });
  it("trước ngày hiệu lực giá gốc vẫn là giá hiện hành", () => {
    const lines = applyAppendixPricing(
      { ...P, items: [item({ code: "A1", name: "Thùng" })] },
      [A("a1", "2026-07-01", [item({ code: "A1", name: "Thùng", unit_price: 5 })])],
      "2026-06-30",
    );
    expect(lines.map((l) => l.current)).toEqual([true, false]);
  });
  it("dòng phụ lục không mã gọi tên ngắn trùng đúng một sản phẩm gốc ⇒ cùng sản phẩm; trùng nhiều ⇒ sản phẩm mới", () => {
    const parent = {
      ...P,
      items: [
        item({ name: "Phí bản quyền", spec: "gói 1" }),
        item({ name: "Cáp", spec: "1m" }),
        item({ name: "Cáp", spec: "2m" }),
      ],
    };
    const l = applyAppendixPricing(
      parent,
      [A("a1", "2026-01-10", [item({ name: "phí bản quyền" }), item({ name: "Cáp" })])],
      "2026-02-01",
    );
    expect(l.map((x) => x.superseded_by)).toEqual(["a1", null, null, null, null]);
  });
});

describe("applyAppendixPricing (phụ lục nối tiếp, dayBefore)", () => {
  it("hai phụ lục nối tiếp: phụ lục sau thay phụ lục trước; phụ lục thiếu ngày không thay gì", () => {
    const l = applyAppendixPricing(
      { ...P, items: [item({ code: "X", name: "x", unit_price: 1 })] },
      [
        A("a2", "2026-09-01", [item({ code: "X", name: "x", unit_price: 3 })]),
        A("a1", "2026-05-01", [item({ code: "X", name: "x", unit_price: 2 })]),
        A("a0", null, [item({ code: "X", name: "x", unit_price: 9 })]),
      ],
      "2026-10-01",
    );
    expect(l.map((x) => [x.source.id, x.valid_to, x.current])).toEqual([
      ["p", "2026-04-30", false],
      ["a1", "2026-08-31", false],
      ["a2", null, true],
      ["a0", null, true],
    ]);
  });
  it("dòng của HĐ gốc có valid_to sớm hơn giữ nguyên; dayBefore qua ranh tháng/năm nhuận", () => {
    const l = applyAppendixPricing(
      { ...P, items: [item({ code: "X", name: "x", valid_to: "2026-01-01" })] },
      [A("a", "2026-03-01", [item({ code: "X", name: "x" })])],
      "2026-03-02",
    );
    expect(l[0]?.valid_to).toBe("2026-01-01");
    expect([dayBefore("2028-03-01"), dayBefore("2027-01-01")]).toEqual([
      "2028-02-29",
      "2026-12-31",
    ]);
    expect(productKey({ code: " ", name: "Đá", spec: null })).toBe("name:da|");
  });
});

describe("gợi ý HĐ gốc", () => {
  const c = (id: string, number: string | null, seller: string | null, buyer: string | null) => ({
    id,
    title: id,
    number,
    seller,
    buyer,
  });
  it("citedNumber: số HĐ sau dòng tiêu đề phụ lục, bỏ dấu câu cuối", () => {
    const src = "# PHỤ LỤC 01\nKèm theo Hợp đồng mua bán số: 01/2026/HĐMB-PN.\nGiữa A và B";
    expect(citedNumber(src)).toBe("01/2026/hdmb-pn");
    expect(citedNumber("Không có gì")).toBeNull();
    expect(citedNumber(null)).toBeNull();
  });
  it("xếp: số nêu > cùng hai bên > cùng bên bán; số khớp bỏ qua dấu câu/hoa thường; tối đa 5", () => {
    const pool = [
      c("s", "H1", "Công ty TNHH Minh Phát", "Cty Khác"),
      c("p", "H2", "CÔNG TY TNHH MINH PHÁT", "Công ty Anh Bình"),
      c("n", "01-2026-HĐMB-PN", "Z Z Z Z", "Q Q Q Q"),
      c("x", "H4", "Không liên quan", "Gì đó"),
    ];
    const out = suggestParents(
      { cited: "01/2026/hdmb-pn", seller: "Cty Minh Phát", buyer: "Công ty Anh Bình" },
      pool,
    );
    expect(out.map((s) => [s.id, s.reason])).toEqual([
      ["n", "cited_number"],
      ["p", "same_parties"],
      ["s", "same_supplier"],
    ]);
    const many = Array.from({ length: 9 }, (_, i) => c(`m${i}`, null, "Minh Phát", null));
    expect(suggestParents({ cited: null, seller: "Minh Phát", buyer: null }, many)).toHaveLength(5);
  });
  it("tên quá ngắn (< 4 ký tự sau bỏ loại hình) không khớp", () => {
    expect(
      suggestParents({ cited: null, seller: "AB", buyer: null }, [c("a", null, "AB", null)]),
    ).toEqual([]);
  });
});

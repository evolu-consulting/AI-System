// com-c7 · CR-102b · R18–R22: luật thuần Lưu báo giá — trạng thái giá (hết hạn/đã thay/đã gỡ), so giá (bằng/rẻ/đắt/giá đầu tiên),
// cảnh báo lệch > 30% và khác VAT, dòng sẽ bị thay. Viết TRƯỚC code (làn đầy đủ, phần giá).
import { describe, expect, it } from "bun:test";
import { buildOverview, type OverviewData } from "./supplier-advice.rules";
import {
  isLive,
  type PricedRow,
  previewQuote,
  priceStatus,
  type QuoteDraft,
  quoteInvalid,
} from "./supplier-quote.rules";

const TODAY = "2026-10-28";
const row = (o: Partial<PricedRow> & { id: string; price: number }): PricedRow => ({
  supplier_name: "NCC",
  party_key: "name:ncc",
  kind: "new",
  unit: "cái",
  source: "quote",
  vat_included: null,
  expires_on: null,
  replaced_at: null,
  removed_at: null,
  ...o,
});
const draft = (o: Partial<QuoteDraft> = {}): QuoteDraft => ({
  party_key: "name:fpt",
  kind: "new",
  price: 100_000,
  unit: "cái",
  vat_included: false,
  ...o,
});
const ctx = { today: TODAY, productUnit: "cái" };

describe("com-c7 · priceStatus (R20–R22)", () => {
  it("gỡ > đã thay > hết hạn > còn hiệu lực; hạn = hôm nay vẫn còn", () => {
    expect(priceStatus(row({ id: "a", price: 1 }), TODAY)).toBe("live");
    expect(priceStatus(row({ id: "a", price: 1, expires_on: TODAY }), TODAY)).toBe("live");
    expect(priceStatus(row({ id: "a", price: 1, expires_on: "2026-10-27" }), TODAY)).toBe(
      "expired",
    );
    const rep = row({
      id: "a",
      price: 1,
      expires_on: "2026-01-01",
      replaced_at: "2026-10-01T00:00:00Z",
    });
    expect(priceStatus(rep, TODAY)).toBe("replaced");
    expect(priceStatus({ ...rep, removed_at: "2026-10-02T00:00:00Z" }, TODAY)).toBe("removed");
    expect(isLive(row({ id: "a", price: 1, expires_on: "2026-10-27" }), TODAY)).toBe(false);
  });
});

describe("com-c7 · previewQuote · so giá (R18)", () => {
  it("chưa có giá cùng loại + cùng đơn vị còn hiệu lực ⇒ giá đầu tiên, không cảnh báo", () => {
    const rows = [
      row({ id: "renew", price: 50_000, kind: "renew" }),
      row({ id: "kg", price: 50_000, unit: "kg" }),
      row({ id: "old", price: 50_000, expires_on: "2026-01-01" }),
      row({ id: "gone", price: 50_000, removed_at: "2026-10-01T00:00:00Z" }),
    ];
    expect(previewQuote(draft(), rows, ctx)).toEqual({
      compare: { kind: "first" },
      warnings: [],
      replaces: [],
    });
  });

  it("so với giá rẻ nhất còn hiệu lực: bằng / rẻ hơn / đắt hơn bao nhiêu", () => {
    const rows = [
      row({ id: "a", price: 120_000 }),
      row({ id: "b", price: 100_000, supplier_name: "Viettel" }),
    ];
    expect(previewQuote(draft({ price: 100_000 }), rows, ctx).compare).toEqual({
      kind: "equal",
      ref_price: 100_000,
      ref_supplier: "Viettel",
      diff: 0,
      pct: 0,
    });
    expect(previewQuote(draft({ price: 90_000 }), rows, ctx).compare).toMatchObject({
      kind: "cheaper",
      diff: -10_000,
      pct: -10,
    });
    expect(previewQuote(draft({ price: 125_000 }), rows, ctx).compare).toMatchObject({
      kind: "dearer",
      diff: 25_000,
      pct: 25,
    });
  });

  it("đơn vị null của giá cũ = đơn vị SP; so chữ không phân biệt hoa thường/khoảng trắng", () => {
    const rows = [row({ id: "a", price: 100_000, unit: null })];
    expect(previewQuote(draft({ unit: " Cái " }), rows, ctx).compare.kind).toBe("equal");
  });
});

describe("com-c7 · previewQuote · cảnh báo (R18, R19)", () => {
  const base = [row({ id: "a", price: 100_000, vat_included: false })];
  it("lệch > 30% (hai chiều) ⇒ cảnh báo; đúng 30% ⇒ không", () => {
    expect(previewQuote(draft({ price: 130_000 }), base, ctx).warnings).toEqual([]);
    expect(previewQuote(draft({ price: 131_000 }), base, ctx).warnings).toEqual([
      { code: "deviation", pct: 31, ref_price: 100_000 },
    ]);
    expect(previewQuote(draft({ price: 60_000 }), base, ctx).warnings).toEqual([
      { code: "deviation", pct: -40, ref_price: 100_000 },
    ]);
  });
  it("khác VAT với giá so ⇒ cảnh báo; giá cũ chưa rõ VAT (null) ⇒ không", () => {
    expect(previewQuote(draft({ vat_included: true }), base, ctx).warnings).toEqual([
      { code: "vat_differs", ref_price: 100_000 },
    ]);
    const unknown = [row({ id: "a", price: 100_000 })];
    expect(previewQuote(draft({ vat_included: true }), unknown, ctx).warnings).toEqual([]);
  });
});

describe("com-c7 · previewQuote · thay giá (R22)", () => {
  it("chỉ giá Báo giá cùng NCC + cùng loại chưa thay/chưa gỡ (kể cả đã hết hạn) bị thay", () => {
    const rows = [
      row({ id: "same", price: 1, party_key: "name:fpt" }),
      row({ id: "expired", price: 1, party_key: "name:fpt", expires_on: "2026-01-01" }),
      row({ id: "manual", price: 1, party_key: "name:fpt", source: "manual" }),
      row({ id: "renew", price: 1, party_key: "name:fpt", kind: "renew" }),
      row({ id: "other", price: 1, party_key: "name:viettel" }),
      row({ id: "done", price: 1, party_key: "name:fpt", replaced_at: "2026-10-01T00:00:00Z" }),
      row({ id: "gone", price: 1, party_key: "name:fpt", removed_at: "2026-10-01T00:00:00Z" }),
    ];
    expect(previewQuote(draft(), rows, ctx).replaces.sort()).toEqual(["expired", "same"]);
  });
});

describe("com-c7 · quoteInvalid", () => {
  it("hạn trước ngày báo giá ⇒ lỗi; còn lại hợp lệ", () => {
    expect(quoteInvalid({ quoted_at: "2026-10-28", expires_on: "2026-10-27" })).toBe(
      "expires_before_quote",
    );
    expect(quoteInvalid({ quoted_at: "2026-10-28", expires_on: "2026-10-28" })).toBeNull();
    expect(quoteInvalid({ quoted_at: "2026-10-28", expires_on: null })).toBeNull();
  });
});

describe("com-c7 · buildOverview bỏ giá hết hạn/thay/gỡ khỏi so sánh (R20–R22)", () => {
  const data: OverviewData = {
    product: { id: "p", name: "SP", unit: "cái", group: "goods" },
    components: [{ mode: "stock", avg_cost: 100 }],
    purchases: [],
    saved: [
      { ...row({ id: "live", price: 200 }), seen_on: TODAY, url: null },
      { ...row({ id: "exp", price: 50, expires_on: "2026-01-01" }), seen_on: TODAY, url: null },
      {
        ...row({ id: "rep", price: 40, replaced_at: "2026-10-01T00:00:00Z" }),
        seen_on: TODAY,
        url: null,
      },
      {
        ...row({ id: "gone", price: 30, removed_at: "2026-10-01T00:00:00Z" }),
        seen_on: TODAY,
        url: null,
      },
    ],
  };
  const o = buildOverview(data, new Map(), TODAY);
  it("bảng hiện giá còn hiệu lực + hết hạn (nhãn); đã thay/đã gỡ chỉ ở lịch sử", () => {
    expect(o.rows.map((r) => [r.id, r.status ?? "live"])).toEqual([
      ["exp", "expired"],
      ["live", "live"],
    ]);
    expect(o.history?.map((r) => [r.id, r.status])).toEqual([
      ["gone", "removed"],
      ["rep", "replaced"],
    ]);
  });
  it("tóm tắt NCC / giá thấp nhất chỉ tính giá còn hiệu lực", () => {
    expect(o.suppliers.map((s) => s.best_price)).toEqual([200]);
  });
});

// V2-F · HD-09 · C12: form của HĐ đã lưu ↔ `fields` + PATCH; gợi ý/tồn kho/gợi ý SP của form.
import { describe, expect, it } from "bun:test";
import type { ProductMatchOut, ProductOut } from "@ai/contracts";
import { badgesOf, fieldKeyOf, formOfDetail, patchOfForm } from "./detail-form";
import { NEW_PRODUCT } from "./form-model";
import { stockHint } from "./stock";
import { suggestionPatch } from "./suggest";

const f = (value: string | number | null, o: Record<string, unknown> = {}) => ({
  value,
  quote: "",
  verified: true,
  edited: false,
  ...o,
});
const detail = (deal: "buy" | "sell" | null) =>
  ({
    deal,
    direction: deal === "buy" ? "purchase" : "sale",
    commission_pct: null,
    commission_fixed: null,
    fields: {
      title: f("HĐ gạo"),
      number: f(null),
      supplier_name: f("Cty A"),
      supplier_tax_id: f(null),
      buyer_name: f("Cty B"),
      buyer_tax_id: f(null),
      supplier_representative: f("Ông A"),
      buyer_representative: f("Bà B"),
      start_date: f("2026-01-01"),
      end_date: f(null),
      notice_days: f(30),
      total_value: f(245_000_000, { verified: false, quote: "245 triệu" }),
      payment_terms: f(null),
    },
    // biome-ignore lint/suspicious/noExplicitAny: dữ liệu thử rút gọn của ContractDetail
  }) as any;

describe("đối tác + người ký theo loại HĐ", () => {
  it("Mua ⇒ đối tác = bên bán; Bán/Giới thiệu ⇒ bên mua", () => {
    expect(fieldKeyOf("buy", "partner_name")).toBe("supplier_name");
    expect(fieldKeyOf("sell", "partner_name")).toBe("buyer_name");
    expect(fieldKeyOf("referral", "partner_signer")).toBe("buyer_representative");
    expect(fieldKeyOf("buy", "our_signer")).toBe("buyer_representative");
    expect(fieldKeyOf("buy", "commission_pct")).toBeNull();
  });
  it("form từ chi tiết; HĐ cũ chưa có deal ⇒ suy từ hướng", () => {
    const a = formOfDetail(detail("buy"));
    expect([a.deal, a.partner_name, a.partner_signer, a.our_signer]).toEqual([
      "buy",
      "Cty A",
      "Ông A",
      "Bà B",
    ]);
    const b = formOfDetail(detail("sell"));
    expect([b.deal, b.partner_name, b.partner_signer]).toEqual(["sell", "Cty B", "Bà B"]);
    expect(formOfDetail({ ...detail(null), direction: "purchase" }).deal).toBe("buy");
  });
});

describe("PATCH chỉ ô đã đổi", () => {
  it("không đổi ⇒ rỗng; số bỏ ký tự không phải số; xoá trắng ⇒ null; đối tác đi đúng khoá", () => {
    const d = detail("buy");
    const form = formOfDetail(d);
    expect(patchOfForm(d, form)).toEqual({});
    expect(
      patchOfForm(d, {
        ...form,
        total_value: "250.000.000 đ",
        number: "  ",
        partner_name: "Cty A2",
        end_date: "",
      }),
    ).toEqual({ total_value: 250_000_000, supplier_name: "Cty A2" });
    expect(patchOfForm(d, { ...form, title: "" })).toEqual({ title: null });
  });
});

describe("dấu hiệu của agent", () => {
  it("chưa kiểm chứng + trích dẫn; ô rỗng không gắn", () => {
    const b = badgesOf(detail("buy"), "AI chưa chắc");
    expect(b.total_value).toEqual([
      { kind: "warn", text: "AI chưa chắc" },
      { kind: "quote", text: "245 triệu" },
    ]);
    expect(b.number).toBeUndefined();
  });
});

const product = (mode: "stock" | "order", onHand = "10", n = 1): ProductOut =>
  ({
    id: "p1",
    name: "Token",
    unit: "cái",
    group: "goods",
    main_supplier: null,
    created_from_contract_id: null,
    rules: [],
    components: Array.from({ length: n }, (_, i) => ({
      id: `c${i}`,
      ord: i,
      name: `T${i}`,
      unit: "cái",
      mode,
      on_hand: onHand,
      avg_cost: 0,
      stock_value: 0,
    })),
  }) as unknown as ProductOut;

describe("5.7e · tồn + Bán vượt tồn", () => {
  it("chỉ HĐ Bán mới cảnh báo; thành phần không giữ hàng ⇒ không nói tới tồn", () => {
    expect(stockHint(product("stock"), "", "12", "sell")).toEqual({
      onHand: 10,
      unit: "cái",
      short: true,
    });
    expect(stockHint(product("stock"), "", "10", "sell")?.short).toBe(false);
    expect(stockHint(product("stock"), "", "12", "buy")?.short).toBe(false);
    expect(stockHint(product("order"), "", "12", "sell")).toBeNull();
    expect(stockHint(undefined, "", "1", "sell")).toBeNull();
  });
  it("nhiều thành phần: cần chọn thành phần mới biết tồn", () => {
    const p = product("stock", "3", 2);
    expect(stockHint(p, "", "5", "sell")).toBeNull();
    expect(stockHint(p, "c1", "5", "sell")?.short).toBe(true);
  });
});

describe("5.5b · gợi ý SP cho dòng", () => {
  const out = (o: Partial<ProductMatchOut>): ProductMatchOut => ({
    suggestions: [],
    create: null,
    ...o,
  });
  it("gợi ý đầu (kèm thành phần) > tạo mới > không gì", () => {
    const p = product("stock", "1", 2);
    expect(
      suggestionPatch(
        out({ suggestions: [{ product: p, component_id: "c1", by: "rule", score: 1 }] }),
        "sell",
      ),
    ).toEqual({
      product_id: "p1",
      component_id: "c1",
      suggested: true,
    });
    expect(
      suggestionPatch(
        out({ suggestions: [{ product: p, component_id: null, by: "words", score: 1 }] }),
        "buy",
      )?.component_id,
    ).toBe("c0");
    expect(suggestionPatch(out({ create: { name: "Gói mới" } }), "referral")).toEqual({
      product_id: NEW_PRODUCT,
      new_name: "Gói mới",
      new_group: "referral",
      suggested: true,
    });
    expect(suggestionPatch(out({}), "buy")).toBeNull();
  });
});

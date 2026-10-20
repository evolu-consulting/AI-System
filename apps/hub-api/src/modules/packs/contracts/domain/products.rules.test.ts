// V2-B · BA §2 / §5.5: kế hoạch SP mới (thành phần + cách lấy hàng theo nhóm) và gợi ý SP cho dòng HĐ.
import { describe, expect, it } from "bun:test";
import type { ProductOut } from "@ai/contracts";
import { matchLine, overlap, pickComponent, productPlan } from "./products.rules";

const comp = (
  id: string,
  name: string,
  mode: ProductOut["components"][number]["mode"] = "stock",
) => ({
  id,
  ord: 0,
  name,
  unit: null,
  mode,
  on_hand: "0",
  avg_cost: 0,
  stock_value: 0,
});
const prod = (
  id: string,
  name: string,
  group: ProductOut["group"],
  o: Partial<ProductOut> = {},
): ProductOut => ({
  id,
  name,
  unit: null,
  group,
  main_supplier: null,
  created_from_contract_id: null,
  components: [comp(`${id}-c`, name)],
  rules: [],
  ...o,
});
const CKS = prod("cks", "Chữ ký số DN – USB Token", "service", {
  components: [comp("cert", "Chứng thư số", "quota"), comp("token", "USB Token")],
  rules: [{ id: "r1", pattern: "USB", component_id: null }],
});
const TAPE = prod("tape", "Băng keo 5cm", "goods");
const INS = prod("ins", "Bảo hiểm xe", "referral");

describe("productPlan", () => {
  it("mặc định một thành phần cùng tên; cách lấy hàng theo nhóm; không giữ hàng ⇒ order", () => {
    expect(productPlan({ name: "Băng keo", unit: "cuộn", group: "goods" })).toEqual({
      components: [{ ord: 0, name: "Băng keo", unit: "cuộn", mode: "stock" }],
      rules: [],
    });
    expect(productPlan({ name: "HĐĐT", group: "service" })).toMatchObject({
      components: [{ mode: "quota" }],
    });
    expect(productPlan({ name: "CKS cá nhân", group: "service", no_stock: true })).toMatchObject({
      components: [{ mode: "order" }],
    });
    expect(productPlan({ name: "Bảo hiểm", group: "referral", no_stock: true })).toMatchObject({
      components: [{ mode: "none" }],
    });
  });
  it("SP nhiều thành phần + quy tắc trỏ thành phần", () => {
    const p = productPlan({
      name: "Chữ ký số DN – USB Token",
      group: "service",
      components: [{ name: "Chứng thư số" }, { name: "USB Token", mode: "stock" }],
      rules: [{ pattern: "USB", component: 1 }],
    });
    expect(p).toEqual({
      components: [
        { ord: 0, name: "Chứng thư số", unit: null, mode: "quota" },
        { ord: 1, name: "USB Token", unit: null, mode: "stock" },
      ],
      rules: [{ pattern: "USB", component: 1 }],
    });
  });
  it("sai ⇒ lý do: cách lấy hàng trái nhóm, tên thành phần trùng, quy tắc trỏ sai / trùng", () => {
    for (const bad of [
      productPlan({ name: "X", group: "goods", components: [{ name: "X", mode: "quota" }] }),
      productPlan({ name: "X", group: "referral", components: [{ name: "X", mode: "stock" }] }),
      productPlan({ name: "X", group: "goods", components: [{ name: "Ống" }, { name: "ống" }] }),
      productPlan({ name: "X", group: "goods", rules: [{ pattern: "ab", component: 3 }] }),
      productPlan({ name: "X", group: "goods", rules: [{ pattern: "Ab" }, { pattern: "ab" }] }),
    ])
      expect(typeof bad).toBe("string");
  });
});

describe("matchLine (BA 5.5b, 5.5f)", () => {
  it("quy tắc nhận diện trước: dòng có chữ 'USB' ⇒ Chữ ký số DN – USB Token; thành phần theo từ: token trắng ⇒ USB Token", () => {
    const r = matchLine("USB Token trắng", "buy", [TAPE, CKS, INS]);
    expect(r.suggestions.map((s) => [s.product.id, s.component_id, s.by])).toEqual([
      ["cks", "token", "rule"],
    ]);
    expect(r.create).toBeNull();
  });
  it("trùng từ (bỏ dấu) ≥ 50%; không khớp ⇒ đề xuất tạo mới từ tên dòng", () => {
    expect(matchLine("BANG KEO 5CM trong", "sell", [TAPE, CKS]).suggestions[0]).toMatchObject({
      product: { id: "tape" },
      by: "words",
      score: 1,
    });
    expect(matchLine("Thùng phi 200L", "buy", [TAPE, CKS])).toEqual({
      suggestions: [],
      create: { name: "Thùng phi 200L" },
    });
  });
  it("HĐ Giới thiệu chỉ gợi ý SP Giới thiệu; HĐ mua/bán không gợi ý SP Giới thiệu", () => {
    expect(
      matchLine("Bảo hiểm xe ô tô", "referral", [TAPE, INS]).suggestions.map((s) => s.product.id),
    ).toEqual(["ins"]);
    expect(matchLine("Bảo hiểm xe ô tô", "sell", [TAPE, INS]).suggestions).toEqual([]);
  });
  it("overlap / pickComponent", () => {
    expect(overlap("usb token trang", "USB Token")).toBe(1);
    expect(pickComponent("chứng thư số 1 năm", CKS)).toBe("cert");
    expect(pickComponent("gói dịch vụ", CKS)).toBeNull();
    expect(pickComponent("bất kỳ", TAPE)).toBe("tape-c");
  });
});

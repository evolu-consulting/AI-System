// products-confirm · BA 5.5: lựa chọn ban đầu của hộp "Gắn sản phẩm" + thân gửi + khớp dòng form ↔ dòng đã lưu.
import { describe, expect, test } from "bun:test";
import type { ContractItem, ProductOut } from "@ai/contracts";
import { EMPTY_LINE, NEW_PRODUCT } from "~/features/contract-form/lib/form-model";
import { candidatesOf, incomplete, initialChoices, newLinksOfForm, toLinks } from "./links";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const item = (n: number, name: string, product_id: string | null = null): ContractItem => ({
  id: id(n),
  ord: n,
  code: null,
  name,
  spec: null,
  unit: "cái",
  qty: 1,
  unit_price: 100,
  vat_rate: null,
  moq: null,
  lead_time_days: null,
  valid_from: null,
  valid_to: null,
  category_id: null,
  quote: null,
  verified: true,
  edited: false,
  product_id,
  component_ids: null,
});
const prod = (n: number, name: string, group: ProductOut["group"] = "goods") =>
  ({ id: id(100 + n), name, group }) as ProductOut;
const P = [
  prod(1, "USB Token"),
  prod(2, "Chữ ký số 1 năm", "service"),
  prod(3, "Phí giới thiệu", "referral"),
];

describe("products-confirm · hộp gắn SP", () => {
  test("SP trùng tên được chọn sẵn; không trùng ⇒ tạo mới; dòng đã gắn giữ SP đó", () => {
    const cs = initialChoices(
      [item(2, "Thiết bị lạ"), item(1, "usb token trắng"), item(3, "Gói", id(102))],
      P,
      "buy",
    );
    expect(cs.map((c) => [c.item_name, c.mode, c.product_id])).toEqual([
      ["usb token trắng", "existing", id(101)],
      ["Thiết bị lạ", "new", ""],
      ["Gói", "existing", id(102)],
    ]);
    expect(cs[1]?.new_name).toBe("Thiết bị lạ");
    expect(incomplete(cs)).toBe(false);
    expect(incomplete([{ ...(cs[0] as (typeof cs)[0]), product_id: "" }])).toBe(true);
  });
  test("HĐ Giới thiệu chỉ gợi ý SP nhóm Giới thiệu; so khớp bỏ dấu", () => {
    expect(candidatesOf("phi gioi thieu", "referral", P).map((p) => p.id)).toEqual([id(103)]);
    expect(candidatesOf("phi gioi thieu", "sell", P)).toEqual([]);
  });
  test("toLinks: có sẵn ⇒ product_id; mới ⇒ new_product (tên, đơn vị, nhóm)", () => {
    const cs = initialChoices([item(1, "USB Token"), item(2, "Lạ")], P, "buy");
    expect(toLinks(cs)).toEqual([
      { item_id: id(1), product_id: id(101) },
      { item_id: id(2), new_product: { name: "Lạ", unit: "cái", group: "goods" } },
    ]);
  });
  test("form đã lưu ra active: chỉ dòng 'tạo mới' thành link, khớp theo thứ tự dòng có tên", () => {
    const lines = [
      { ...EMPTY_LINE, name: "A", product_id: id(101) },
      { ...EMPTY_LINE, name: "" },
      { ...EMPTY_LINE, name: "B", unit: "hộp", product_id: NEW_PRODUCT, new_name: "SP B" },
    ];
    expect(newLinksOfForm(lines, [item(1, "B"), item(0, "A")])).toEqual([
      { item_id: id(1), new_product: { name: "SP B", unit: "hộp", group: "goods" } },
    ]);
  });
});

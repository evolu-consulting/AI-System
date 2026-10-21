// gap-d1 #21/#22 · "Nhập giá tay", báo giá tải lên ⇒ thân lưu, "Thêm vào Đối tác".
import { describe, expect, it } from "bun:test";
import { companyBody, manualPriceBody, toSaveItems } from "./suppliers";

const form = {
  supplier: " FPT ",
  taxId: "",
  kind: "new" as const,
  price: "1.200.000",
  unit: "cái",
  date: "",
  note: "",
};

describe("manualPriceBody", () => {
  it("cần NCC + giá nguyên dương; nguồn manual", () => {
    expect(manualPriceBody({ ...form, supplier: " " })).toBeNull();
    expect(manualPriceBody({ ...form, price: "0" })).toBeNull();
    expect(manualPriceBody({ ...form, price: "abc" })).toBeNull();
    expect(manualPriceBody(form)).toEqual({
      supplier_name: "FPT",
      supplier_tax_id: null,
      kind: "new",
      price: 1_200_000,
      unit: "cái",
      seen_on: null,
      note: null,
      source: "manual",
    });
  });
});

describe("toSaveItems nguồn quote", () => {
  it("báo giá tải lên lưu với nguồn quote, không url", () => {
    const [x] = toSaveItems(
      [
        {
          supplier_name: "B",
          kind: "renew",
          price: 5,
          unit: null,
          url: null,
          seen_on: null,
          note: null,
        },
      ],
      "quote",
    );
    expect(x).toMatchObject({ source: "quote", url: null, kind: "renew" });
  });
});

describe("companyBody", () => {
  it("khoá tax:<MST> ⇒ gửi MST; khoá khác / không khoá ⇒ chỉ tên", () => {
    expect(companyBody({ supplier_name: "A", party_key: "tax:0100684378" })).toEqual({
      name: "A",
      tax_id: "0100684378",
    });
    expect(companyBody({ supplier_name: "A", party_key: "name:a" })).toEqual({ name: "A" });
    expect(companyBody({ supplier_name: "A", party_key: null })).toEqual({ name: "A" });
  });
});

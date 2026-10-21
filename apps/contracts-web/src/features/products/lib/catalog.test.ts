// gap-d1 · luật thuần form Sản phẩm & Giá.
import { describe, expect, it } from "bun:test";
import { avgPreview, lotBody, moneyOf, productBody, ruleBody, sourceBody } from "./catalog";

const lot = {
  qty: "5",
  price: "1.200.000",
  date: "",
  expires: "",
  supplier: "",
  taxId: "",
  componentId: "",
};

describe("moneyOf", () => {
  it("số nguyên có dấu ngăn nghìn; chữ/âm/lẻ sai", () => {
    expect([moneyOf("1.200.000"), moneyOf("0"), moneyOf("12 000")]).toEqual([1_200_000, 0, 12_000]);
    expect([moneyOf("abc"), moneyOf("-5"), moneyOf("")]).toEqual([null, null, null]);
  });
});

describe("productBody", () => {
  it("cần tên; trường trống ⇒ null", () => {
    expect(productBody({ name: " ", group: "goods", unit: "", spec: "" })).toBeNull();
    expect(productBody({ name: " Cáp ", group: "goods", unit: "cuộn", spec: "" })).toEqual({
      name: "Cáp",
      group: "goods",
      unit: "cuộn",
      spec: null,
    });
  });
});

describe("lotBody", () => {
  it("SL > 0, giá ≥ 0; NCC kèm MST; gói suất bắt buộc hạn", () => {
    expect(lotBody({ ...lot, qty: "0" }, false)).toBeNull();
    expect(lotBody({ ...lot, price: "x" }, false)).toBeNull();
    expect(lotBody({ ...lot, qty: "2,5", supplier: "A", taxId: "0100" }, false)).toMatchObject({
      qty: "2.5",
      unit_price: 1_200_000,
      supplier: { name: "A", tax_id: "0100" },
      expires_on: null,
    });
    expect(lotBody(lot, true)).toBeNull();
    expect(lotBody({ ...lot, expires: "2027-01-01" }, true)?.expires_on).toBe("2027-01-01");
  });
});

describe("sourceBody", () => {
  it("cần NCC; số tuỳ chọn nhưng nếu có phải đúng", () => {
    const f = {
      supplier: "Viettel",
      taxId: "",
      leadDays: "5",
      moq: "10",
      priceRef: "120.000",
      note: "",
    };
    expect(sourceBody({ ...f, supplier: "" })).toBeNull();
    expect(sourceBody(f)).toMatchObject({
      supplier_name: "Viettel",
      lead_days: 5,
      moq: "10",
      price_ref: 120_000,
    });
    expect(sourceBody({ ...f, leadDays: "x" })).toBeNull();
    expect(sourceBody({ ...f, moq: "0" })).toBeNull();
    expect(sourceBody({ ...f, priceRef: "abc" })).toBeNull();
    expect(sourceBody({ ...f, leadDays: "", moq: "", priceRef: "" })).toMatchObject({
      lead_days: null,
      moq: null,
      price_ref: null,
    });
  });
});

describe("ruleBody", () => {
  it("2–100 ký tự", () => {
    expect(ruleBody("a", "")).toBeNull();
    expect(ruleBody(" token usb ", "c1")).toEqual({ pattern: "token usb", component_id: "c1" });
  });
});
describe("avgPreview", () => {
  it("BQ gia quyền; thiếu số ⇒ null", () => {
    expect(avgPreview("10", 100_000, "10", "200.000")).toBe(150_000);
    expect(avgPreview("0", 0, "3", "1000")).toBe(1000);
    expect(avgPreview("10", 100_000, "", "200000")).toBeNull();
  });
});

// CR-191 BR-191-6 · gợi ý hàng hoá: đơn vị từ số lượng, Sản phẩm & Giá trước + hàng đã đăng, khử trùng theo tên, ≤ 8, đối tác ngoài ⇒ rỗng.
import { describe, expect, it } from "bun:test";
import type { Access } from "./community-access";
import { type GoodsCatalog, suggestGoods, unitOf } from "./goods-suggest.service";

const host = { org: null, who: { tenantId: "t", userId: "u" } } as unknown as Access;
const partner = { org: "o1", who: { tenantId: "t", userId: "u" } } as unknown as Access;
const uow = (rows: unknown[]) =>
  ({
    tenant: async (_w: unknown, cb: (c: unknown) => unknown) =>
      cb({ tx: { execute: async () => rows } }),
  }) as never;

describe("CR-191 goods-suggest", () => {
  it("đơn vị lấy từ số lượng đã đăng", () => {
    expect(unitOf("100 cuộn")).toBe("cuộn");
    expect(unitOf("1.500,5 thùng phi")).toBe("thùng phi");
    expect(unitOf("nhiều")).toBe("");
    expect(unitOf(null)).toBe("");
  });

  it("Sản phẩm & Giá trước, hàng đã đăng sau, khử trùng theo tên không phân biệt hoa/thường, ≤ 8", async () => {
    const catalog: GoodsCatalog = async () => [
      { name: "Băng keo 5cm", unit: "cuộn", price: "12.000", source: "catalog" },
    ];
    const rows = [
      { name: "băng keo 5CM", qty: "10 cuộn", price: "9.000" },
      { name: "Thùng phi", qty: "3 thùng", price: null },
    ];
    expect(await suggestGoods(uow(rows), host, catalog, "")).toEqual([
      { name: "Băng keo 5cm", unit: "cuộn", price: "12.000", source: "catalog" },
      { name: "Thùng phi", unit: "thùng", source: "posted" },
    ]);
    const many = Array.from({ length: 12 }, (_, i) => ({ name: `H${i}`, qty: null, price: null }));
    expect((await suggestGoods(uow(many), host, undefined, "")).length).toBe(8);
  });

  it("cổng Sản phẩm & Giá lỗi ⇒ vẫn trả hàng đã đăng, đối tác ngoài ⇒ rỗng", async () => {
    const bad: GoodsCatalog = async () => {
      throw new Error("x");
    };
    const rows = [{ name: "Dây điện", qty: "5 cuộn", price: "1" }];
    expect((await suggestGoods(uow(rows), host, bad, "d")).map((g) => g.name)).toEqual([
      "Dây điện",
    ]);
    expect(await suggestGoods(uow(rows), partner, undefined, "")).toEqual([]);
  });
});

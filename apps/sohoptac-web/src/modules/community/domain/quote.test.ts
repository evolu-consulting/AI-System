// CR-102b · C7b · unit logic thuần form Lưu báo giá + gợi ý.
import { describe, expect, test } from "bun:test";
import type { PostView } from "@ai/contracts/community";
import {
  compareText,
  hasErrors,
  hintLines,
  parseVnd,
  prefill,
  quoteErrors,
  saveButtonLabel,
  toQuoteInput,
  unitFromQty,
  warningText,
} from "./quote";

const post = {
  type: "sell",
  fields: { product: "Băng keo 5cm", qty: "100 cuộn", price: "12.000đ" },
} as unknown as PostView;

describe("quote form logic", () => {
  test("parseVnd", () => {
    expect(parseVnd("95.000đ")).toBe(95000);
    expect(parseVnd("95k")).toBe(95000);
    expect(parseVnd("1,2tr")).toBe(1_200_000);
    expect(parseVnd("liên hệ")).toBeNull();
    expect(parseVnd(null)).toBeNull();
  });
  test("unitFromQty", () => {
    expect(unitFromQty("100 cuộn")).toBe("cuộn");
    expect(unitFromQty("50")).toBe("");
  });
  test("prefill từ bài; có SP khớp thì chọn; từ bình luận không điền giá", () => {
    const d = prefill(post, { supplier: "Tân Phát", now: new Date("2026-10-28T00:00:00Z") });
    expect(d).toMatchObject({
      productId: "new",
      newName: "Băng keo 5cm",
      price: "12000",
      unit: "cuộn",
      quotedAt: "2026-10-28",
    });
    const hint = {
      match: { productId: "p1", name: "Băng keo", unit: "cuộn", how: "exact" },
    } as never;
    expect(prefill(post, { supplier: "x", hint }).productId).toBe("p1");
    expect(prefill(post, { supplier: "x", commentId: "c1" }).price).toBe("");
  });
  test("lỗi form + thân gửi", () => {
    const d = { ...prefill(post, { supplier: "x" }), price: "" };
    expect(quoteErrors(d).price).toBeDefined();
    expect(hasErrors(quoteErrors({ ...d, price: "5000", expiresOn: "2000-01-01" }))).toBe(true);
    const ok = { ...d, price: "5000", expiresOn: "" };
    expect(hasErrors(quoteErrors(ok))).toBe(false);
    expect(toQuoteInput(ok)).toMatchObject({
      price: 5000,
      newProduct: { name: "Băng keo 5cm" },
      expiresOn: null,
    });
    expect(toQuoteInput({ ...ok, productId: "p1" })).toMatchObject({ productId: "p1" });
  });
  test("câu so giá + cảnh báo + nhãn nút", () => {
    expect(compareText({ kind: "first" })).toContain("đầu tiên");
    expect(
      compareText({ kind: "cheaper", refPrice: 100, refSupplier: "A", diff: -10, pct: -10 }),
    ).toContain("Rẻ hơn");
    expect(
      compareText({ kind: "dearer", refPrice: 100, refSupplier: "A", diff: 10, pct: 10 }),
    ).toContain("Đắt hơn");
    expect(warningText({ code: "deviation", pct: 45, refPrice: 100 })).toContain("45");
    expect(warningText({ code: "vat_differs", refPrice: 100 })).toContain("VAT");
    expect(saveButtonLabel(0)).toBe("Lưu báo giá");
    expect(saveButtonLabel(1)).toBe("Lưu thêm báo giá");
  });
  test("gợi ý: Cần mua có hàng ⇒ khớp hàng đang có", () => {
    const h = {
      match: { productId: "p", name: "Băng keo", unit: "cuộn", how: "exact" },
      onHand: "20",
      avgCost: 9000,
      best: null,
      reputation: null,
      inStock: true,
    } as never;
    expect(hintLines(h, "buy").lead).toBe("Khớp hàng đang có:");
    expect(hintLines(h, "sell").lead).toBe("Băng keo:");
    expect(hintLines({ match: null } as never, "sell").text).toContain("chưa có");
  });
});

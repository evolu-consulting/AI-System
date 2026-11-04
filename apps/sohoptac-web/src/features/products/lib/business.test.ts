// V2-J1 · tab nhóm, "đang nắm giữ", màu thanh điểm của danh sách Sản phẩm.
import { describe, expect, test } from "bun:test";
import type { BizProductRow } from "@ai/contracts";
import { barTone, catalogTabOf, filterTab, heldView, qtyText } from "./business";

const row = (o: Partial<BizProductRow>): BizProductRow => ({
  id: "p",
  name: "SP",
  unit: "cái",
  group: "goods",
  kind: "stock",
  held: { qty: 0, unit: "cái", expires_on: null, value: 0 },
  sold_12m: 0,
  sold_3m: 0,
  business: { score: null, suggestion: null, reason: "", factors: [] },
  ...o,
});

describe("tab nhóm", () => {
  test("tab lạ ⇒ Tất cả; lọc theo nhóm", () => {
    expect(catalogTabOf("zzz")).toBe("all");
    expect(catalogTabOf("service")).toBe("service");
    const all = [
      row({ id: "a" }),
      row({ id: "b", group: "service" }),
      row({ id: "c", group: "referral" }),
    ];
    expect(filterTab(all, "all")).toHaveLength(3);
    expect(filterTab(all, "service").map((x) => x.id)).toEqual(["b"]);
  });
});

describe("đang nắm giữ", () => {
  test("không giữ / kho / gói suất kèm hạn", () => {
    expect(heldView(row({}))).toEqual({ kind: "none" });
    expect(heldView(row({ held: { qty: 1500, unit: "cái", expires_on: null, value: 1 } }))).toEqual(
      {
        kind: "qty",
        text: "1.500 cái",
      },
    );
    expect(
      heldView(
        row({ kind: "quota", held: { qty: 40, unit: "suất", expires_on: "2026-12-31", value: 1 } }),
      ),
    ).toEqual({ kind: "quota", text: "40 suất", expiresOn: "2026-12-31" });
    expect(qtyText(2.5)).toBe("2,5");
  });
  test("thanh điểm: ≥ 70 tốt · ≥ 45 chú ý · dưới ⇒ yếu · không có ⇒ xám", () => {
    expect([70, 45, 44, null].map(barTone)).toEqual(["ok", "soon", "late", "grey"]);
  });
});

// HD-FR-96 · S08 · luật hiển thị tab giá CKS.
import { describe, expect, test } from "bun:test";
import type { CksPackageRow } from "@ai/contracts";
import { rowTone, tr } from "./prices";

describe("cks-prices lib", () => {
  test("tr: triệu một chữ số thập phân kiểu Việt", () => {
    expect(tr(4_950_000)).toBe("4,95 tr");
    expect(tr(12_000_000)).toBe("12,0 tr");
  });
  test("rowTone: trên thị trường thắng rẻ nhất", () => {
    const r = (flags: CksPackageRow["flags"]) => ({ flags }) as CksPackageRow;
    expect(rowTone(r(["cheapest_buy", "above_market"]))).toBe("bg-soon-bg/60");
    expect(rowTone(r(["cheapest_buy"]))).toBe("bg-ok-bg/60");
    expect(rowTone(r([]))).toBe("");
  });
});

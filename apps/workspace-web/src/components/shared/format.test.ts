// PK-FR-10 · TF2 · định dạng số/ngày kiểu Việt (port từ mgmt-app ui.tsx).
import { describe, expect, test } from "bun:test";
import { parseMoney, parseQty, viDate, vnd } from "./format";

describe("format", () => {
  test("vnd: nhóm nghìn bằng dấu chấm; null → —", () => {
    expect(vnd(91500000)).toBe("91.500.000");
    expect(vnd(null)).toBe("—");
  });
  test("viDate: ngày thuần, timestamp UTC về giờ Việt Nam", () => {
    expect(viDate("2026-10-16")).toBe("16/10/2026");
    expect(viDate("2026-10-15T23:30:00+00:00")).toBe("16/10/2026");
    expect(viDate(undefined)).toBe("—");
  });
  test("parseMoney: bỏ ký tự không phải số", () => {
    expect(parseMoney("91.500.000 đ")).toBe(91500000);
    expect(parseMoney("  ")).toBeNull();
    expect(parseMoney("abc")).toBeNaN();
  });
  test("parseQty: dấu chấm nhóm nghìn, dấu phẩy thập phân, kiểu máy", () => {
    expect(parseQty("1.500")).toBe(1500);
    expect(parseQty("1,5")).toBe(1.5);
    expect(parseQty("1.5")).toBe(1.5);
    expect(parseQty("")).toBeNull();
    expect(parseQty("1,2,3")).toBeNaN();
  });
});

// ADM-FR-51 · test bộ lọc URL của Nhật ký.
import { describe, expect, test } from "bun:test";
import { periodFromSearch, rangeForUrl, validateAuditSearch } from "./search";

const today = new Date(2026, 9, 3);

describe("validateAuditSearch", () => {
  test("bỏ giá trị lạ và `config`; from/to cần đủ cặp hợp lệ", () => {
    const s = validateAuditSearch({ entity: "config", action: "x", from: "2026-10-01", q: "a" });
    expect(s).toEqual({ q: "a" } as typeof s);
    expect(
      validateAuditSearch({ entity: "user_totp", from: "2026-10-01", to: "2026-10-02" }),
    ).toMatchObject({
      entity: "user_totp",
      from: "2026-10-01",
      to: "2026-10-02",
    });
  });
});

describe("period", () => {
  test("mặc định 30 ngày; khoảng 7 ngày nhận ra preset; khác → custom", () => {
    expect(periodFromSearch({}, today)).toEqual({ kind: "preset", days: 30 });
    expect(periodFromSearch({ from: "2026-09-27", to: "2026-10-03" }, today)).toEqual({
      kind: "preset",
      days: 7,
    });
    expect(periodFromSearch({ from: "2026-09-01", to: "2026-09-05" }, today).kind).toBe("custom");
  });
  test("30 ngày không ghi lên URL", () => {
    expect(rangeForUrl({ kind: "preset", days: 30 }, today)).toEqual({
      from: undefined,
      to: undefined,
    });
    expect(rangeForUrl({ kind: "preset", days: 7 }, today)).toEqual({
      from: "2026-09-27",
      to: "2026-10-03",
    });
  });
});

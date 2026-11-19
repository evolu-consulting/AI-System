// CR-189 · key Group sinh từ tên phòng: bỏ dấu, không trùng, trần số lần thử.
import { describe, expect, test } from "bun:test";
import { isAppError } from "../../lib/errors";
import { groupKeyOf } from "./org.shared";

describe("groupKeyOf", () => {
  test("bỏ dấu, thường, gạch nối, tên rỗng/ký hiệu ⇒ phong, một ký tự ⇒ đủ 2 ký tự", () => {
    expect(groupKeyOf("Kinh doanh miền Bắc", new Set())).toBe("kinh-doanh-mien-bac");
    expect(groupKeyOf("Đội 1", new Set())).toBe("doi-1");
    expect(groupKeyOf("???", new Set())).toBe("phong");
    expect(groupKeyOf("A", new Set())).toBe("a-1");
  });
  test("trùng ⇒ hậu tố -2, -3…, quá 1000 lần thử ⇒ KEY_TAKEN thay vì lặp mãi", () => {
    expect(groupKeyOf("Kế toán", new Set(["ke-toan", "ke-toan-2"]))).toBe("ke-toan-3");
    const full = new Set(["ke-toan", ...Array.from({ length: 999 }, (_, i) => `ke-toan-${i + 2}`)]);
    expect(
      isAppError(
        (() => {
          try {
            groupKeyOf("Kế toán", full);
            return null;
          } catch (e) {
            return e;
          }
        })(),
        "KEY_TAKEN",
      ),
    ).toBe(true);
    expect(
      groupKeyOf(
        "Kế toán",
        new Set(["ke-toan", ...Array.from({ length: 998 }, (_, i) => `ke-toan-${i + 2}`)]),
      ),
    ).toBe("ke-toan-1000");
  });
});

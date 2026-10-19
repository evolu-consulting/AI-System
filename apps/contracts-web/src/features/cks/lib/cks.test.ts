// HD-FR-92…95 · S10/S11 · luật thuần màn CKS (port dialogs.tsx / CksCustomerPage.tsx).
import { describe, expect, test } from "bun:test";
import { ApiError } from "@ai/web-kit/http";
import { autoValid, cksErrorText, dayPlus, daysUntil, num, uploadReport } from "./cks";

const t = (k: string, o?: Record<string, unknown>) => (o ? `${k}:${JSON.stringify(o)}` : k);

describe("cks lib", () => {
  test("dayPlus theo giờ Việt Nam: 23:30 UTC đã là hôm sau", () => {
    expect(dayPlus(0, new Date("2026-10-18T23:30:00Z"))).toBe("2026-10-19");
    expect(dayPlus(2, new Date("2026-10-18T01:00:00Z"))).toBe("2026-10-20");
  });
  test("num bỏ dấu chấm; autoValid theo năm của lô, 29/2 ⇒ 28/2", () => {
    expect(num("1.650.000")).toBe(1_650_000);
    expect(num(null)).toBe(0);
    expect(autoValid("2026-10-18", 1)).toBe("2027-10-18");
    expect(autoValid("2028-02-29", 1)).toBe("2029-02-28");
    expect(autoValid("2028-02-29", 4)).toBe("2032-02-29");
  });
  test("daysUntil", () => {
    expect(daysUntil("2026-10-27", "2026-10-18")).toBe(9);
    expect(daysUntil("2026-10-12", "2026-10-18")).toBe(-6);
  });
  test("uploadReport: chỉ báo phần có; khớp = added − unmatched", () => {
    expect(uploadReport({ added: 3, skipped: 1, unmatched: 1, unreadable: 0 }, t)).toEqual({
      toast: 'contracts.cks.customer.attached:{"n":2}',
      issues: 'contracts.cks.customer.unmatched:{"n":1} · contracts.cks.customer.skipped:{"n":1}',
    });
    expect(uploadReport({ added: 0, skipped: 0, unmatched: 0, unreadable: 2 }, t)).toEqual({
      toast: null,
      issues: 'contracts.cks.customer.unreadable:{"n":2}',
    });
  });
  test("cksErrorText theo mã; mã lạ ⇒ câu chung", () => {
    expect(cksErrorText(new ApiError(409, "CKS_STOCK" as never, "x"), t)).toBe(
      "contracts.cks.errors.CKS_STOCK",
    );
    expect(cksErrorText(new ApiError(500, "INTERNAL_ERROR" as never, "x"), t)).toBe(
      "contracts.errors.unknown",
    );
    expect(cksErrorText(new Error("x"), t)).toBe("contracts.errors.unknown");
  });
});

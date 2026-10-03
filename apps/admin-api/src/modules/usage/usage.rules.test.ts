// ADM-FR-42 · M4-R08 · ca biên bổ sung cho usage.rules (acceptance ở tests/acceptance/M4/rules/usage.rules.test.ts).
import { describe, expect, it } from "bun:test";
import { csvColumns, resolveUsageTenant, stripCost, toCsv, usageRange } from "./usage.rules";

const now = new Date("2026-10-31T18:00:00Z"); // 01:00 VN ngày 01/11

describe("ADM-FR-42 · usageRange biên", () => {
  it("mặc định theo tháng VN (UTC đã sang tháng sau theo VN)", () => {
    const r = usageRange({}, now);
    if (r === "invalid") throw new Error("invalid");
    expect(r.days[0]).toBe("2026-11-01");
    expect(r.days).toHaveLength(30);
  });

  it("chỉ có from → to = cuối tháng hiện tại; from sau cuối tháng → invalid", () => {
    const r = usageRange({ from: "2026-11-20" }, now);
    if (r === "invalid") throw new Error("invalid");
    expect(r.days.at(-1)).toBe("2026-11-30");
    expect(usageRange({ from: "2026-12-01" }, now)).toBe("invalid");
  });

  it("ngày hỏng → invalid (không ném)", () => {
    expect(usageRange({ from: "2026-02-30", to: "2026-03-01" }, now)).toBe("invalid");
    expect(usageRange({ from: "2026-13-01", to: "2026-13-02" }, now)).toBe("invalid");
  });
});

describe("ADM-FR-42 · M4-R08 · CSV/strip", () => {
  it("toCsv kết thúc bằng CRLF; chỉ tiêu đề khi không có dòng", () => {
    expect(toCsv(["a"], [])).toBe("﻿a\r\n");
    expect(toCsv(csvColumns("tenant_admin"), []).includes("cost_usd")).toBe(false);
  });

  it("member không được coi là platform: stripCost xoá cost; resolveUsageTenant như tenant", () => {
    expect(stripCost("member", { cost_usd: "1", x: [{ margin_usd: "1" }] }) as unknown).toEqual({
      x: [{}],
    });
    expect(resolveUsageTenant({ role: "member", tenantId: "t" }, "u")).toBe("not_found");
  });
});

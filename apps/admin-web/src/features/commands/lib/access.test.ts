// ADM-FR-24 · M2-R23 · accessSummary.
import { describe, expect, test } from "bun:test";
import { accessSummary } from "./access";

const t = (key: string, p?: Record<string, string | number>) =>
  `${key}:${Object.entries(p ?? {})
    .map(([k, v]) => `${k}=${v}`)
    .join(",")}`;

describe("ADM-FR-24 · accessSummary", () => {
  test("một trang: cộng user active của các tenant", () => {
    const items = [
      { active_user_count: 6 },
      { active_user_count: 3 },
      { active_user_count: 2 },
      { active_user_count: 0 },
    ];
    expect(accessSummary(t, 4, items)).toBe("commands.access.summary:tenants=4,users=11");
  });

  test("hơn một trang: chỉ số tenant", () => {
    expect(accessSummary(t, 51, [])).toBe("commands.access.summaryTenants:tenants=51");
  });

  test("không có tenant nào", () => {
    expect(accessSummary(t, 0, [])).toBe("commands.access.summary:tenants=0,users=0");
  });
});

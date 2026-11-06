import { describe, expect, test } from "bun:test";
import { SYSTEM_ENTRIES, systemEntriesFor } from "./registry";

const ids = (role: Parameters<typeof systemEntriesFor>[0], frozen = true) =>
  systemEntriesFor(role, frozen).map((e) => e.id);

describe("CR-121 c22 · registry màn Hệ thống", () => {
  test("platform_admin thấy đủ 9 mục (có Danh mục tính năng)", () => {
    expect(ids("platform_admin")).toEqual([
      "usage",
      "audit",
      "feedback",
      "health",
      "features",
      "secrets",
      "sources",
      "dlcSteps",
      "transfer",
    ]);
  });
  test("tenant_admin chỉ thấy Chi phí · Nhật ký · Góp ý, member không thấy gì", () => {
    expect(ids("tenant_admin")).toEqual(["usage", "audit", "feedback"]);
    expect(ids("member")).toEqual([]);
    expect(ids(undefined)).toEqual([]);
  });
  test("cờ đóng băng tắt ⇒ ẩn Nguồn và Import/Export", () => {
    expect(ids("platform_admin", false)).toEqual([
      "usage",
      "audit",
      "feedback",
      "health",
      "features",
      "secrets",
      "dlcSteps",
    ]);
  });
  test("mỗi mục có khoá mô tả riêng và đường dẫn duy nhất", () => {
    expect(new Set(SYSTEM_ENTRIES.map((e) => e.to)).size).toBe(SYSTEM_ENTRIES.length);
    for (const e of SYSTEM_ENTRIES) expect(e.descKey).toBe(`system.hub.${e.id}`);
  });
});

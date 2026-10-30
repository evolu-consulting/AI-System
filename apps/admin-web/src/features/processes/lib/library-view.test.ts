import { describe, expect, test } from "bun:test";
import {
  assignPlan,
  canAssign,
  canSetDefault,
  inUseReason,
  isLibraryRow,
  normalizePreview,
  parseSampleValue,
  publishState,
  settledCounts,
  tenantUsage,
} from "./library-view";

describe("library-view", () => {
  test("inUseReason: mặc định thắng, rồi tới đang gán", () => {
    expect(
      inUseReason({ slot: "contracts.approval", is_default: true, tenant_count: 2, enabled: true }),
    ).toBe("default");
    expect(inUseReason({ is_default: false, tenant_count: 3, enabled: true })).toBe("assigned");
    expect(inUseReason({ is_default: false, tenant_count: 0, enabled: true })).toBeNull();
    expect(inUseReason({ enabled: true })).toBeNull();
  });
  test("isLibraryRow + tenantUsage", () => {
    expect(isLibraryRow({ slot: "contracts.approval" })).toBe(true);
    expect(isLibraryRow({ slot: null })).toBe(false);
    expect(tenantUsage({ tenant_count: 2, is_default: true })).toEqual({
      count: 2,
      isDefault: true,
    });
    expect(tenantUsage({})).toEqual({ count: 0, isDefault: false });
  });
  test("publishState / canSetDefault / canAssign", () => {
    expect(publishState({ slot: null, published_version: null })).toBe("none");
    expect(publishState({ slot: "s", published_version: null })).toBe("draft");
    expect(publishState({ slot: "s", published_version: 4 })).toBe("published");
    expect(canAssign({ slot: "s", published_version: null })).toBe(false);
    expect(canAssign({ slot: "s", published_version: 1 })).toBe(true);
    expect(canSetDefault({ slot: "s", published_version: 1, is_default: true })).toBe(false);
    expect(canSetDefault({ slot: "s", published_version: 1, is_default: false })).toBe(true);
  });
  test("assignPlan: thêm tenant mới, bỏ tenant bỏ chọn", () => {
    expect(assignPlan(["a", "b"], ["b", "c"])).toEqual({ add: ["c"], remove: ["a"] });
    expect(assignPlan([], [])).toEqual({ add: [], remove: [] });
  });
  test("normalizePreview chịu hai dạng + thiếu tên", () => {
    const want = [
      { key: "s0", name: "Trưởng phòng", run: true },
      { key: "s1", name: "s1", run: false },
    ];
    expect(
      normalizePreview({
        steps: [
          { key: "s0", name: "Trưởng phòng", run: true },
          { key: "s1", run: false },
        ],
      }),
    ).toEqual(want);
    expect(
      normalizePreview([
        { key: "s0", name: "Trưởng phòng" },
        { key: "s1", skipped: true },
      ]),
    ).toEqual(want);
    expect(normalizePreview(null)).toEqual([]);
    expect(normalizePreview({ steps: [1, "x"] })).toEqual([]);
  });
  test("parseSampleValue: 50.000.000 → số; trống → null; chữ → invalid", () => {
    expect(parseSampleValue("50.000.000")).toBe(50_000_000);
    expect(parseSampleValue("  ")).toBeNull();
    expect(parseSampleValue("5tr")).toBe("invalid");
  });
  test("settledCounts", () => {
    expect(
      settledCounts([
        { status: "fulfilled", value: 1 },
        { status: "rejected", reason: new Error("x") },
      ]),
    ).toEqual({ ok: 1, failed: 1 });
  });
});

describe("errorLines", () => {
  test("issues, paths, keys + tenant", async () => {
    const { errorLines } = await import("./library-view");
    expect(
      errorLines({ issues: [{ path: "steps.1", rule: "UNREACHABLE" }, { rule: "X" }, 5] }),
    ).toEqual(["steps.1: UNREACHABLE", "X"]);
    expect(errorLines({ paths: ["stages.2", 3] })).toEqual(["stages.2"]);
    expect(errorLines({ tenant: "demo", keys: ["pb-a", "pb-b"] })).toEqual(["demo: pb-a, pb-b"]);
    expect(errorLines(null)).toEqual([]);
  });
});

describe("splitRule + errorLines có dịch luật", () => {
  test("SYSTEM_TOOL_MISSING:<tool> và UNREACHABLE_STEP", async () => {
    const { splitRule, errorLines } = await import("./library-view");
    expect(splitRule("SYSTEM_TOOL_MISSING:contracts-route")).toEqual({
      code: "SYSTEM_TOOL_MISSING",
      arg: "contracts-route",
    });
    expect(splitRule("UNREACHABLE_STEP")).toEqual({ code: "UNREACHABLE_STEP", arg: null });
    const fmt = (path: string, code: string, arg: string | null) =>
      code === "SYSTEM_TOOL_MISSING"
        ? `thiếu ${arg}`
        : code === "UNREACHABLE_STEP"
          ? `không tới được ${path}`
          : null;
    expect(
      errorLines(
        {
          issues: [
            { path: "stages", rule: "SYSTEM_TOOL_MISSING:contracts-finalize" },
            { path: "stages.2", rule: "UNREACHABLE_STEP" },
            { path: "x", rule: "OTHER" },
          ],
        },
        fmt,
      ),
    ).toEqual(["thiếu contracts-finalize", "không tới được stages.2", "x: OTHER"]);
  });
});

describe("tab Mẫu · chạy thử", () => {
  test("rowMode: mẫu toàn nền tảng chỉ chép được khi không có quyền sửa mẫu; def tenant luôn đầy đủ", async () => {
    const { rowMode } = await import("./library-view");
    expect(rowMode({ is_template: true }, false)).toBe("copy");
    expect(rowMode({ is_template: true }, true)).toBe("full");
    expect(rowMode({ is_template: false }, false)).toBe("full");
  });
  test("rowsForTab: tab mẫu giữ nguyên (Hub đã lọc kind=sample), tab chính áp bộ lọc Bật/Tắt", async () => {
    const { rowsForTab } = await import("./library-view");
    const rows = [
      { id: "a", enabled: true },
      { id: "b", enabled: false },
    ];
    expect(rowsForTab(rows, true, "on")).toEqual(rows);
    expect(rowsForTab(rows, false, "all")).toEqual(rows);
    expect(rowsForTab(rows, false, "on").map((r) => r.id)).toEqual(["a"]);
    expect(rowsForTab(rows, false, "off").map((r) => r.id)).toEqual(["b"]);
  });
});

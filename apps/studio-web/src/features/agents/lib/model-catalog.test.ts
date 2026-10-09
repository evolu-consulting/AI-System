// CR-054 · phân nhóm danh mục model.
import { describe, expect, test } from "bun:test";
import type { ModelCatalogItem } from "@ai/contracts/studio";
import { formatFetchedAt, groupModels, latestFetchedAt, modelValueLabel } from "./model-catalog";

const item = (value: string, fetched_at = "2026-10-08T03:00:00.000Z"): ModelCatalogItem => ({
  provider_key: "claude",
  value,
  resolved_model: null,
  display_name: value,
  description: "",
  fetched_at,
});

describe("groupModels", () => {
  test("alias lên nhóm mới nhất, id cụ thể xuống bản cố định, giữ thứ tự, bỏ trùng", () => {
    const g = groupModels([
      item("default"),
      item("claude-opus-4-1"),
      item("sonnet"),
      item("haiku"),
      item("sonnet"),
      item("claude-sonnet-4-5"),
    ]);
    expect(g.latest.map((m) => m.value)).toEqual(["default", "sonnet", "haiku"]);
    expect(g.pinned.map((m) => m.value)).toEqual(["claude-opus-4-1", "claude-sonnet-4-5"]);
  });

  test("rỗng", () => {
    expect(groupModels([])).toEqual({ latest: [], pinned: [] });
  });
});

describe("latestFetchedAt / formatFetchedAt", () => {
  test("lấy mốc mới nhất; rỗng → null → chuỗi rỗng", () => {
    const at = latestFetchedAt([item("a", "2026-10-07T00:00:00.000Z"), item("b")]);
    expect(at).toBe("2026-10-08T03:00:00.000Z");
    expect(latestFetchedAt([])).toBeNull();
    expect(formatFetchedAt(null)).toBe("");
    expect(formatFetchedAt("không phải ngày")).toBe("");
    expect(formatFetchedAt(at)).toMatch(/^\d{2}:\d{2} \d{2}\/\d{2}\/2026$/);
  });
});

describe("modelValueLabel", () => {
  test("alias → kèm id thật; id cố định / chưa biết id → giữ nguyên", () => {
    expect(modelValueLabel({ value: "sonnet", resolved_model: "claude-sonnet-5-5" })).toBe(
      "sonnet → claude-sonnet-5-5",
    );
    expect(
      modelValueLabel({ value: "claude-fable-5-1[1m]", resolved_model: "claude-fable-5-1[1m]" }),
    ).toBe("claude-fable-5-1[1m]");
    expect(modelValueLabel({ value: "haiku", resolved_model: null })).toBe("haiku");
  });
});

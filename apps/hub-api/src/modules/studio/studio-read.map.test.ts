// HUB-FR-72 · HUB-FR-64 · H4a-R13 · unit B3: `toList`, `usableFor` (QB3), `toProviderItem` (không secret).
import { describe, expect, test } from "bun:test";
import { ProviderItemSchema } from "@ai/contracts/studio";
import { toList, toProviderItem, usableFor } from "./studio-read.map";

const text = (r: { key: string }) => [r.key];
const rows = [{ key: "alpha" }, { key: "Beta" }, { key: "gamma" }];

describe("H4a B3 · toList", () => {
  test("HUB-FR-72 · không q ⇒ đủ; limit cắt + truncated; total = số khớp", () => {
    expect(toList(rows, { limit: 200, version: 7, text })).toEqual({
      items: rows,
      total: 3,
      truncated: false,
      hub_config_version: 7,
    });
    const cut = toList(rows, { limit: 2, version: 1, text });
    expect([cut.items.length, cut.total, cut.truncated]).toEqual([2, 3, true]);
  });
  test("HUB-FR-72 · q không phân biệt hoa thường, chứa chuỗi", () => {
    expect(toList(rows, { q: "BET", limit: 200, version: 0, text }).items).toEqual([
      { key: "Beta" },
    ]);
    expect(toList(rows, { q: "zz", limit: 200, version: 0, text }).total).toBe(0);
  });
});

describe("H4a B3 · usableFor (QB3)", () => {
  const inp = (name: string, type: string, required: boolean) => ({
    name,
    type,
    required,
    description: `Mô tả ${name}`,
  });
  test("HUB-FR-64 · workflow có input text bắt buộc duy nhất ⇒ tool + dify-workflow", () => {
    expect(usableFor("workflow", [inp("source_text", "text", true)])).toEqual([
      "tool",
      "dify-workflow",
    ]);
  });
  test("HUB-FR-64 · chat/agent có `query` ⇒ tool + dify-agent", () => {
    expect(usableFor("chat", [inp("query", "text", true)])).toEqual(["tool", "dify-agent"]);
    expect(usableFor("agent", [inp("query", "text", true)])).toEqual(["tool", "dify-agent"]);
  });
  test("HUB-FR-64 · không có input nhận tin / schema hỏng ⇒ chỉ tool", () => {
    expect(usableFor("workflow", [inp("n", "number", true)])).toEqual(["tool"]);
    expect(usableFor("workflow", "khong-phai-mang")).toEqual(["tool"]);
  });
});

describe("H4a B3 · toProviderItem (R13)", () => {
  const base = {
    id: "a0000000-0000-4000-8000-000000000001",
    key: "claude-sub",
    kind: "subscription",
    vendor: "anthropic",
    baseUrl: null,
    hasSecret: true,
    maxConcurrency: 2,
    enabled: true,
    devOnly: false,
    status: null,
    cooldownUntil: null,
    utilization: null,
  };
  test("HUB-FR-68 · khớp schema strict, state null khi chưa có provider_state, không khoá secret", () => {
    const item = toProviderItem({ ...base, secretId: "x", lastError: "boom" } as typeof base);
    expect(ProviderItemSchema.parse(item)).toEqual(item);
    expect(item.state).toBeNull();
    expect(Object.keys(item)).not.toContain("secret_id");
    expect(JSON.stringify(item)).not.toContain("boom");
  });
  test("HUB-FR-68 · có state ⇒ cooldown_until ISO", () => {
    const at = new Date("2026-10-06T01:02:03.000Z");
    const item = toProviderItem({
      ...base,
      status: "cooldown",
      cooldownUntil: at,
      utilization: 0.5,
    });
    expect(item.state).toEqual({
      status: "cooldown",
      cooldown_until: at.toISOString(),
      utilization: 0.5,
    });
  });
});

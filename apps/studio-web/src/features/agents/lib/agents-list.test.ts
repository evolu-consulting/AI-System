// studio-agents-list · luật thuần: banner "Cần chú ý" bỏ qua agent chạy nền/đã gộp; lọc danh sách (retired ẩn trừ khi bật "Đang tắt", surface).
import { describe, expect, test } from "bun:test";
import type { AgentListItem } from "@ai/contracts/studio";
import { hasFilters, matchesFilters, parseSearch } from "./filters";
import { enabledButNotGranted, isBackground, isRetired } from "./status";

const item = (key: string, o: Partial<AgentListItem> = {}): AgentListItem => ({
  id: key,
  key,
  name: { vi: `Tên ${key}`, en: `Name ${key}` },
  description: `Agent ${key}`,
  runtime: "agentic-cli",
  enabled: true,
  version: 1,
  updated_at: "2026-01-01T00:00:00.000Z",
  profile: null,
  workflow_count: 0,
  entitled_tenant_count: 0,
  orchestrator_of: { default: false, tenant_ids: [] },
  runnable: true,
  ...o,
});
const retired = item("mgmt-assistant", {
  enabled: false,
  alias_of: { id: "a", key: "assistant" },
});
const bg = item("price-scout", { surface: "background" });

describe("studio-agents-list · banner", () => {
  test("agent nền và agent đã gộp không bị tính là 'chưa cấp'", () => {
    const got = enabledButNotGranted([item("chat-0"), bg, { ...retired, enabled: true }]);
    expect(got.map((a) => a.key)).toEqual(["chat-0"]);
    expect(isBackground(bg)).toBe(true);
    expect(isRetired(retired)).toBe(true);
    expect(isRetired(item("x"))).toBe(false);
  });
});

describe("studio-agents-list · lọc", () => {
  test("agent đã gộp ẩn mặc định, hiện khi status=off; agent nền vẫn hiện", () => {
    expect(matchesFilters(retired, { q: "" })).toBe(false);
    expect(matchesFilters(retired, { q: "", status: "on" })).toBe(false);
    expect(matchesFilters(retired, { q: "", status: "off" })).toBe(true);
    expect(matchesFilters(bg, { q: "" })).toBe(true);
  });
  test("chip Surface: chat (mặc định khi vắng) / background", () => {
    expect(matchesFilters(bg, { q: "", surface: "background" })).toBe(true);
    expect(matchesFilters(bg, { q: "", surface: "chat" })).toBe(false);
    expect(matchesFilters(item("c"), { q: "", surface: "chat" })).toBe(true);
    expect(matchesFilters(item("c"), { q: "", surface: "background" })).toBe(false);
    expect(hasFilters({ q: "", surface: "chat" })).toBe(true);
    expect(parseSearch({ surface: "background" }).surface).toBe("background");
    expect(parseSearch({ surface: "zzz" }).surface).toBeUndefined();
  });
});

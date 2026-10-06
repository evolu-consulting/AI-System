import { describe, expect, test } from "bun:test";
import type { AgentListItem } from "@ai/contracts/studio";
import { hasFilters, matchesFilters, parseSearch, toServerParams } from "./filters";
import { overlapByAgent } from "./overlap";
import { canSetAsOrchestrator, enabledButNotGranted, isOrchestrator } from "./status";

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
  entitled_tenant_count: 1,
  orchestrator_of: { default: false, tenant_ids: [] },
  runnable: true,
  ...o,
});

describe("filters", () => {
  test("parseSearch bỏ giá trị lạ", () => {
    expect(parseSearch({ q: " ", runtime: "x", status: "zzz" })).toEqual({
      q: undefined,
      runtime: undefined,
      status: undefined,
    });
    expect(parseSearch({ q: "a", runtime: "llm", status: "off" })).toEqual({
      q: "a",
      runtime: "llm",
      status: "off",
    });
  });
  test("matchesFilters: key/tên không phân biệt hoa thường + runtime + trạng thái", () => {
    const a = item("hoadon");
    expect(matchesFilters(a, { q: "HOA" })).toBe(true);
    expect(matchesFilters(a, { q: "name hoa" })).toBe(true);
    expect(matchesFilters(a, { q: "dify" })).toBe(false);
    expect(matchesFilters(a, { q: "", runtime: "llm" })).toBe(false);
    expect(matchesFilters(a, { q: "", status: "off" })).toBe(false);
    expect(matchesFilters(item("x", { enabled: false }), { q: "", status: "off" })).toBe(true);
  });
  test("toServerParams / hasFilters", () => {
    expect(toServerParams({ q: " dify ", status: "off" })).toEqual({
      q: "dify",
      runtime: undefined,
      enabled: "false",
    });
    expect(hasFilters({ q: "" })).toBe(false);
    expect(hasFilters({ q: "", status: "on" })).toBe(true);
  });
});

describe("overlap + status", () => {
  test("hai mô tả giống nhau → cả hai có badge; agent tắt thì không", () => {
    const d = "Xử lý hoá đơn nhà cung cấp và kiểm tra số tiền";
    const m = overlapByAgent([
      item("a", { description: d }),
      item("b", { description: d }),
      item("c", { description: d, enabled: false }),
      item("d", { description: "Hoàn toàn khác biệt ở đây thôi" }),
    ]);
    expect([...m.keys()].sort()).toEqual(["a", "b"]);
  });
  test("Orchestrator / canSetAsOrchestrator / banner", () => {
    const orch = item("o", { orchestrator_of: { default: true, tenant_ids: [] } });
    const ofTenant = item("t", { orchestrator_of: { default: false, tenant_ids: ["x"] } });
    expect(isOrchestrator(orch)).toBe(true);
    expect(isOrchestrator(ofTenant)).toBe(true);
    expect(canSetAsOrchestrator(item("a"))).toBe(true);
    expect(canSetAsOrchestrator(orch)).toBe(false);
    expect(canSetAsOrchestrator(item("d", { runtime: "dify-workflow" }))).toBe(false);
    expect(canSetAsOrchestrator(item("e", { enabled: false }))).toBe(false);
    const g = enabledButNotGranted([
      item("a"),
      item("b", { entitled_tenant_count: 0 }),
      item("c", { entitled_tenant_count: 0, enabled: false }),
    ]);
    expect(g.map((x) => x.key)).toEqual(["b"]);
  });
});
